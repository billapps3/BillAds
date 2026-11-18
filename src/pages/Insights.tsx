import { useState, useEffect } from 'react'
import { useCampaigns } from '@/hooks/useCampaignData'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircle, Loader2, Zap, TrendingUp, TrendingDown, Target, CheckCircle2, RefreshCw } from 'lucide-react'
import { OpenAIInsightsService } from '@/services/openai-insights-service'
import { SupabaseService } from '@/services/supabase-service'
import { SyncService } from '@/services/sync-service'

const ANALYSIS_WINDOW_DAYS = 7

function toISODate(d: Date) {
  return d.toISOString().split('T')[0]
}

function formatDateBR(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

// Janela "atual" = últimos N dias; janela "anterior" = N dias imediatamente antes dela.
// Evita que a análise dilua mudanças recentes (segmentação, criativo) com meses de histórico acumulado.
function getAnalysisWindows() {
  const today = new Date()
  const currentEnd = toISODate(today)
  const currentStart = toISODate(new Date(today.getTime() - (ANALYSIS_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000))

  const prevEndDate = new Date(today.getTime() - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000)
  const prevStartDate = new Date(prevEndDate.getTime() - (ANALYSIS_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000)
  const previousEnd = toISODate(prevEndDate)
  const previousStart = toISODate(prevStartDate)

  return {
    currentStart,
    currentEnd,
    previousStart,
    previousEnd,
    currentLabel: `últimos ${ANALYSIS_WINDOW_DAYS} dias (${formatDateBR(currentStart)} a ${formatDateBR(currentEnd)})`,
    previousLabel: `${ANALYSIS_WINDOW_DAYS} dias anteriores (${formatDateBR(previousStart)} a ${formatDateBR(previousEnd)})`,
  }
}

interface CampaignWithAccount {
  campaign: any
  accountName: string
}

interface CampaignAnalysis {
  campaignId: string
  campaignName: string
  accountName: string
  platform: string
  insights: any[]
  score: number
  status: 'analyzing' | 'completed' | 'error'
  error?: string
}

export default function Insights() {
  const { data: allCampaigns, isLoading, refetch: refetchCampaigns } = useCampaigns()
  const [integrations, setIntegrations] = useState<any[]>([])
  const [analyses, setAnalyses] = useState<CampaignAnalysis[]>([])
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisStep, setAnalysisStep] = useState('')
  const [selectedCampaigns, setSelectedCampaigns] = useState<Set<string>>(new Set())
  const [lastAnalysisWindow, setLastAnalysisWindow] = useState<{ currentLabel: string; previousLabel: string } | null>(null)

  // Foca só em campanhas ativas - análise de histórico pausado é um recurso separado
  const campaigns = (allCampaigns || []).filter(c => c.status === 'active' || (c.status as string) === 'ACTIVE')

  // Carregar integrações para saber nomes das contas
  useEffect(() => {
    const loadIntegrations = async () => {
      try {
        const { data: { user } } = await SupabaseService.supabase.auth.getUser()
        if (user) {
          const { data } = await SupabaseService.supabase
            .from('integrations')
            .select('*')
            .eq('user_id', user.id)
          setIntegrations(data || [])
        }
      } catch (error) {
        console.error('Error loading integrations:', error)
      }
    }
    loadIntegrations()
  }, [])

  const getAccountName = (platform: string, campaignId: string) => {
    const integration = integrations.find(i => i.platform === platform)
    return integration?.platform_account_name || 'Conta Desconhecida'
  }

  const toggleCampaignSelection = (campaignId: string) => {
    const newSelected = new Set(selectedCampaigns)
    if (newSelected.has(campaignId)) {
      newSelected.delete(campaignId)
    } else {
      newSelected.add(campaignId)
    }
    setSelectedCampaigns(newSelected)
  }

  const toggleSelectAll = () => {
    if (!campaigns) return
    if (selectedCampaigns.size === campaigns.length) {
      setSelectedCampaigns(new Set())
    } else {
      setSelectedCampaigns(new Set(campaigns.map(c => c.id)))
    }
  }

  const analyzeSelectedCampaigns = async () => {
    if (selectedCampaigns.size === 0 || !campaigns) return

    setAnalyzing(true)
    const openaiService = new OpenAIInsightsService()
    const selectedIds = new Set(selectedCampaigns)

    // Sincroniza antes de analisar: sem isso, a segmentação/criativo e as métricas usadas na análise
    // podem estar com dias (ou semanas) de defasagem em relação ao que o usuário mudou no Meta.
    setAnalysisStep('Sincronizando dados mais recentes do Meta Ads...')
    try {
      await SyncService.syncAllCampaigns()
    } catch (error) {
      console.error('Falha ao sincronizar antes da análise:', error)
    }
    const { data: freshCampaigns } = await refetchCampaigns()
    const freshActiveCampaigns = (freshCampaigns || []).filter(
      c => c.status === 'active' || (c.status as string) === 'ACTIVE'
    )
    setAnalysisStep('')

    const campaignsToAnalyze = freshActiveCampaigns.filter(c => selectedIds.has(c.id))
    const newAnalyses: CampaignAnalysis[] = campaignsToAnalyze.map(campaign => ({
      campaignId: campaign.id,
      campaignName: campaign.campaign_name,
      accountName: getAccountName(campaign.platform, campaign.id),
      platform: campaign.platform,
      insights: [],
      score: 0,
      status: 'analyzing',
    }))

    setAnalyses(newAnalyses)

    const windows = getAnalysisWindows()
    setLastAnalysisWindow({ currentLabel: windows.currentLabel, previousLabel: windows.previousLabel })

    // Analisar cada campanha selecionada
    for (let i = 0; i < campaignsToAnalyze.length; i++) {
      const campaign = campaignsToAnalyze[i]
      const analysisIndex = newAnalyses.findIndex(a => a.campaignId === campaign.id)

      try {
        // Janela recente (últimos N dias) é o que importa de verdade para decisões no presente -
        // olhar todo o histórico acumulado dilui mudanças recentes de segmentação/criativo/orçamento.
        const metrics = await SupabaseService.getCampaignMetrics(campaign.id, windows.currentStart, windows.currentEnd)
        const previousMetrics = await SupabaseService.getCampaignMetrics(campaign.id, windows.previousStart, windows.previousEnd)

        if (metrics.length === 0) {
          // Pode ser campanha muito nova ou sync ainda não trouxe dados do período - confere se existe ALGUM dado histórico
          const anyMetrics = await SupabaseService.getCampaignMetrics(campaign.id)
          newAnalyses[analysisIndex].status = 'completed'
          newAnalyses[analysisIndex].insights = [
            anyMetrics.length === 0
              ? {
                  title: 'Sem dados ainda',
                  description: 'Esta campanha ainda não possui métricas registradas.',
                  recommended_action: 'Aguarde a sincronização de dados',
                  confidence: 0,
                }
              : {
                  title: `Sem dados nos ${windows.currentLabel}`,
                  description: `Existem métricas antigas para esta campanha, mas nenhuma dentro do período analisado (${windows.currentLabel}). Isso pode indicar que a campanha ficou sem veiculação recente ou que a sincronização ainda não trouxe os dias mais novos.`,
                  recommended_action: 'Sincronize novamente em alguns minutos e verifique se a campanha está mesmo ativa e com orçamento disponível no Meta Ads Manager.',
                  confidence: 0,
                },
          ]
          newAnalyses[analysisIndex].score = 50
          setAnalyses([...newAnalyses])
          continue
        }

        // Analisar com OpenAI, incluindo contexto de destino/segmentação/criativo capturado na sincronização
        const metadata = (campaign as any).metadata || {}
        const insights = await openaiService.analyzePerformance({
          campaign_name: campaign.campaign_name,
          platform: campaign.platform,
          metrics,
          previous_period_metrics: previousMetrics.length > 0 ? previousMetrics : undefined,
          period_label: windows.currentLabel,
          previous_period_label: windows.previousLabel,
          context: {
            objective: campaign.objective,
            destination_type: metadata.destination_type,
            optimization_goal: metadata.optimization_goal,
            billing_event: metadata.billing_event,
            bid_strategy: metadata.bid_strategy,
            targeting_summary: metadata.targeting_summary,
            creative_summary: metadata.creative_summary,
            daily_budget: campaign.daily_budget,
            total_ads: metadata.total_ads,
            last_synced_at: campaign.synced_at,
            active_ad_sets_count: metadata.active_ad_sets_count,
          },
        })

        // Salvar insights no banco
        for (const insight of insights) {
          await SupabaseService.saveInsight(campaign.id, insight)
        }

        // Calcular score (0-100)
        const avgConfidence = insights.reduce((sum, i) => sum + (i.confidence || 0), 0) / insights.length
        const score = Math.round(avgConfidence)

        newAnalyses[analysisIndex].insights = insights
        newAnalyses[analysisIndex].score = score
        newAnalyses[analysisIndex].status = 'completed'
      } catch (error) {
        console.error(`Erro ao analisar ${campaign.campaign_name}:`, error)
        newAnalyses[analysisIndex].status = 'error'
        newAnalyses[analysisIndex].error = String(error)
        newAnalyses[analysisIndex].score = 0
      }

      setAnalyses([...newAnalyses])
    }

    setAnalyzing(false)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-muted-foreground">Carregando campanhas...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Insights & Análises</h1>
        <p className="text-muted-foreground mt-1">IA especialista em tráfego pago analisando suas campanhas ativas</p>
      </div>

      {!isLoading && campaigns.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground text-center">
              Nenhuma campanha ativa no momento. A análise de IA foca em campanhas ativas, onde as recomendações têm impacto imediato.
              Sincronize suas integrações em Configurações se você ativou uma campanha recentemente.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Seleção de Campanhas */}
      {!analyzing && campaigns && campaigns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Selecione Campanhas para Analisar</CardTitle>
            <CardDescription>Escolha quais campanhas deseja analisar com IA</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Selecionar Todas */}
            <div className="flex items-center gap-2 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer">
              <input
                type="checkbox"
                id="select-all"
                checked={selectedCampaigns.size === campaigns.length}
                onChange={toggleSelectAll}
                className="w-4 h-4 cursor-pointer"
              />
              <label htmlFor="select-all" className="flex-1 cursor-pointer font-medium">
                Selecionar Todas as Campanhas Ativas ({campaigns.length})
              </label>
              <span className="text-sm text-muted-foreground">
                {selectedCampaigns.size} selecionadas
              </span>
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {campaigns.map(campaign => (
                <div
                  key={campaign.id}
                  className="flex items-center gap-3 p-3 border rounded-lg hover:bg-muted/50 cursor-pointer"
                  onClick={() => toggleCampaignSelection(campaign.id)}
                >
                  <input
                    type="checkbox"
                    checked={selectedCampaigns.has(campaign.id)}
                    onChange={() => {}}
                    className="w-4 h-4 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{campaign.campaign_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {getAccountName(campaign.platform, campaign.id)} • {campaign.platform === 'meta' ? '📱 Meta Ads' : '🔍 Google Ads'}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${
                    campaign.status === 'active'
                      ? 'bg-green-500/20 text-green-700'
                      : 'bg-gray-500/20 text-gray-700'
                  }`}>
                    {campaign.status === 'active' ? 'Ativa' : campaign.status}
                  </span>
                </div>
              ))}
            </div>

            {/* Botão Analisar */}
            <button
              onClick={analyzeSelectedCampaigns}
              disabled={selectedCampaigns.size === 0}
              className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all disabled:opacity-50 font-medium"
            >
              {selectedCampaigns.size === 0 ? (
                <>Selecione campanhas para analisar</>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  Analisar {selectedCampaigns.size} Campanha{selectedCampaigns.size > 1 ? 's' : ''}
                </>
              )}
            </button>
          </CardContent>
        </Card>
      )}

      {analyzing && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-6 flex items-center gap-3">
            {analysisStep ? <RefreshCw className="w-5 h-5 animate-spin text-blue-600" /> : <Loader2 className="w-5 h-5 animate-spin text-blue-600" />}
            <p className="text-sm text-blue-700 font-medium">
              {analysisStep || `Analisando ${selectedCampaigns.size} campanha(s) com IA...`}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Período usado na análise */}
      {lastAnalysisWindow && !analyzing && analyses.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Período analisado: {lastAnalysisWindow.currentLabel} • comparado com {lastAnalysisWindow.previousLabel}
        </p>
      )}

      {/* Resumo geral */}
      {analyses.length > 0 && !analyzing && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Campanhas Analisadas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {analyses.filter(a => a.status === 'completed').length}/{analyses.length}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Score Médio</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">
                {Math.round(
                  analyses.filter(a => a.status === 'completed').reduce((sum, a) => sum + a.score, 0) /
                    Math.max(1, analyses.filter(a => a.status === 'completed').length)
                )}
                %
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Alertas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-red-600">
                {analyses.reduce((sum, a) => sum + (a.insights.length || 0), 0)}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Lista de campanhas com insights */}
      <div className="space-y-4">
        {analyses.map(analysis => (
          <Card key={analysis.campaignId} className="overflow-hidden">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div>
                    <CardTitle className="text-lg">{analysis.campaignName}</CardTitle>
                    <CardDescription>
                      {analysis.accountName} • {analysis.platform === 'meta' ? '📱 Meta Ads' : '🔍 Google Ads'}
                    </CardDescription>
                  </div>
                  <div className="text-right">
                    <div className="text-3xl font-bold text-blue-600">{analysis.score}%</div>
                    <p className="text-xs text-muted-foreground">Score</p>
                  </div>
                </div>
                <div className="text-right">
                  {analysis.status === 'analyzing' && (
                    <div className="flex items-center gap-2 text-blue-600">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">Analisando...</span>
                    </div>
                  )}
                  {analysis.status === 'completed' && (
                    <div className="flex items-center gap-2 text-green-600">
                      <span className="w-2 h-2 bg-green-600 rounded-full"></span>
                      <span className="text-sm">Análise concluída</span>
                    </div>
                  )}
                  {analysis.status === 'error' && (
                    <div className="flex items-center gap-2 text-red-600">
                      <AlertCircle className="w-4 h-4" />
                      <span className="text-sm">Erro na análise</span>
                    </div>
                  )}
                </div>
              </div>
            </CardHeader>

            {analysis.insights.length > 0 && (
              <CardContent className="space-y-4">
                {analysis.insights.map((insight, idx) => (
                  <div key={idx} className="p-4 border rounded-lg space-y-2">
                    <div className="flex items-start justify-between">
                      <h4 className="font-semibold text-sm flex items-center gap-2">
                        {insight.confidence > 75 ? (
                          <TrendingUp className="w-4 h-4 text-green-600" />
                        ) : insight.confidence > 50 ? (
                          <Target className="w-4 h-4 text-yellow-600" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-red-600" />
                        )}
                        {insight.title}
                      </h4>
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {Math.round(insight.confidence)}% confiança
                      </span>
                    </div>

                    <p className="text-sm text-muted-foreground">{insight.description}</p>

                    {insight.recommended_action && (
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm">
                        <p className="font-medium text-blue-900">💡 Ação recomendada:</p>
                        <p className="text-blue-800 mt-1">{insight.recommended_action}</p>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            )}

            {analysis.error && (
              <CardContent>
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600">Erro: {analysis.error}</p>
                </div>
              </CardContent>
            )}
          </Card>
        ))}

        {analyses.length === 0 && (
          <Card>
            <CardContent className="pt-12 pb-12">
              <div className="text-center space-y-4">
                <Zap className="w-16 h-16 mx-auto text-blue-600 opacity-50" />
                <h3 className="text-lg font-semibold">Comece a Análise</h3>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Clique no botão acima para analisar suas campanhas com inteligência artificial. O sistema vai gerar insights automáticos e recomendações.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
