import { DailyMetrics, CampaignInsight } from '@/types/ads';

interface CampaignContext {
  objective?: string;
  destination_type?: string;
  optimization_goal?: string;
  billing_event?: string;
  bid_strategy?: string;
  targeting_summary?: {
    age_min?: number;
    age_max?: number;
    genders?: number[];
    geo_locations?: string[];
    interests?: string[];
    custom_audiences?: string[];
  };
  creative_summary?: {
    title?: string;
    body?: string;
    call_to_action?: string;
    format?: string;
    destination_url?: string;
  };
  daily_budget?: number;
  total_ads?: number;
  last_synced_at?: string;
  active_ad_sets_count?: number;
}

interface OpenAIInsightRequest {
  campaign_name: string;
  platform: string;
  metrics: DailyMetrics[];
  previous_period_metrics?: DailyMetrics[];
  period_label?: string;
  previous_period_label?: string;
  context?: CampaignContext;
}

interface MetricsSummary {
  totalSpend: number;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  totalReach: number;
  avgCTR: number;
  avgCPC: number;
  avgCPA?: number;
  avgFrequency: number;
  daysActive: number;
  actionsBreakdown: Record<string, number>;
}

// Mapeia destination_type/objective do Meta para uma descrição humana do que "conversão" significa ali
const DESTINATION_LABELS: Record<string, string> = {
  WHATSAPP: 'WhatsApp (iniciar conversa)',
  MESSENGER: 'Messenger (iniciar conversa)',
  INSTAGRAM_DIRECT: 'Instagram Direct (iniciar conversa)',
  WEBSITE: 'Site/Landing page externa',
  APP: 'Abertura de aplicativo',
  ON_AD: 'Formulário instantâneo (lead ad)',
  PHONE_CALL: 'Ligação telefônica',
};

export class OpenAIInsightsService {
  private apiKey: string;
  private model: string = 'gpt-4o-mini';

  constructor(apiKey: string = import.meta.env.VITE_OPENAI_API_KEY || '') {
    this.apiKey = apiKey;
  }

  /**
   * Analyze campaign performance using OpenAI GPT-4o-mini
   */
  async analyzePerformance(request: OpenAIInsightRequest): Promise<CampaignInsight[]> {
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    if (!request.metrics || request.metrics.length === 0) {
      throw new Error('No metrics available for analysis');
    }

    const currentSummary = this.calculateMetricsSummary(request.metrics);
    const previousSummary = request.previous_period_metrics
      ? this.calculateMetricsSummary(request.previous_period_metrics)
      : null;

    const prompt = this.buildAdvancedPrompt(request, currentSummary, previousSummary);

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: this.getSystemPrompt(),
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.6,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || 'OpenAI API error');
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;

      if (!content) {
        throw new Error('No response from OpenAI');
      }

      return this.parseInsights(content, request.campaign_name);
    } catch (error) {
      console.error('OpenAI analysis error:', error);
      throw error;
    }
  }

  /**
   * System prompt - define o comportamento e especialidade da IA
   */
  private getSystemPrompt(): string {
    return `Você é um media buyer sênior, especialista em tráfego pago com 15+ anos de experiência prática gerenciando orçamentos de Meta Ads (Facebook/Instagram) e Google Ads para negócios locais, e-commerce, geração de leads e campanhas de conversa (WhatsApp/Messenger).

Você NÃO é um analista genérico de métricas - você é um especialista que entende que cada combinação de objetivo + destino do anúncio tem benchmarks e lógica de otimização DIFERENTES:

- Campanhas para WHATSAPP/MESSENGER: o que importa é custo por conversa iniciada (não CPA de compra), qualidade da conversa, se o copy do anúncio já filtra quem não tem intenção real, e se a resposta no WhatsApp é rápida (isso afeta o algoritmo). CTR baixo aqui pode ser normal se a oferta for muito específica.
- Campanhas para SITE/LANDING PAGE (tráfego ou conversão): CTR, qualidade da página de destino, velocidade de carregamento, e se o pixel está disparando corretamente importam muito.
- Campanhas de LEAD AD (formulário instantâneo): a fricção é baixíssima, então CTR/custo por lead tende a ser melhor, mas a QUALIDADE do lead costuma ser pior - avalie se o volume de leads faz sentido vs o copy ser vago demais.
- Campanhas de ENGAJAMENTO: curtidas/comentários não pagam contas - questione se o objetivo da campanha faz sentido para o negócio.

Sua análise SEMPRE considera, em conjunto:
1. Os números (CTR, CPC, CPA, frequência, alcance, conversões) comparados ao benchmark CORRETO para aquele destino/objetivo específico - nunca aplique benchmark de e-commerce para uma campanha de WhatsApp.
2. O criativo (texto do anúncio, CTA, formato) - se o copy bate com o público e a oferta.
3. A segmentação (idade, localização, interesses) - se faz sentido para o que está sendo vendido.
4. Frequência alta (>3-4) com CTR caindo = fadiga de criativo, precisa trocar o anúncio.
5. Orçamento vs volume de dados - campanha com pouco gasto/poucos cliques não tem dados suficientes para decisões definitivas, isso deve ser dito claramente.

Sua análise deve ser:
- Específica: use os números reais fornecidos, nunca genérico
- Contextualizada ao destino do anúncio: nunca dê a mesma recomendação para WhatsApp e para e-commerce
- Acionável: cada recomendação deve ser um passo concreto que o gestor de tráfego pode executar hoje
- Priorizada: comece pelo problema de maior impacto no resultado do negócio, não só no CTR
- Honesta sobre incerteza: se os dados são poucos, diga isso em vez de forçar uma conclusão
- Em português brasileiro, direto, sem enrolação de "consultor"`;
  }

  /**
   * Calcula estatísticas agregadas dos métricas, incluindo breakdown de actions (ex: mensagens iniciadas no WhatsApp)
   */
  private calculateMetricsSummary(metrics: DailyMetrics[]): MetricsSummary {
    const total = metrics.reduce(
      (acc, m) => ({
        spend: acc.spend + (m.spend || 0),
        impressions: acc.impressions + (m.impressions || 0),
        clicks: acc.clicks + (m.clicks || 0),
        conversions: acc.conversions + (m.conversions || 0),
        reach: Math.max(acc.reach, m.reach || 0),
        frequencySum: acc.frequencySum + (m.frequency || 0),
      }),
      { spend: 0, impressions: 0, clicks: 0, conversions: 0, reach: 0, frequencySum: 0 }
    );

    const actionsBreakdown: Record<string, number> = {};
    for (const m of metrics) {
      const breakdown = (m.custom_metrics as any)?.actionsBreakdown as Array<{ type: string; value: number }> | undefined;
      if (breakdown) {
        for (const a of breakdown) {
          actionsBreakdown[a.type] = (actionsBreakdown[a.type] || 0) + a.value;
        }
      }
    }

    const avgCTR = total.impressions > 0 ? (total.clicks / total.impressions) * 100 : 0;
    const avgCPC = total.clicks > 0 ? total.spend / total.clicks : 0;
    const avgCPA = total.conversions > 0 ? total.spend / total.conversions : undefined;

    return {
      totalSpend: total.spend,
      totalImpressions: total.impressions,
      totalClicks: total.clicks,
      totalConversions: total.conversions,
      totalReach: total.reach,
      avgCTR: parseFloat(avgCTR.toFixed(2)),
      avgCPC: parseFloat(avgCPC.toFixed(2)),
      avgCPA: avgCPA ? parseFloat(avgCPA.toFixed(2)) : undefined,
      avgFrequency: parseFloat((total.frequencySum / Math.max(1, metrics.length)).toFixed(2)),
      daysActive: metrics.length,
      actionsBreakdown,
    };
  }

  /**
   * Calcula variação percentual entre dois períodos
   */
  private calculateVariation(current: number, previous: number): number {
    if (previous === 0) return 0;
    return parseFloat((((current - previous) / previous) * 100).toFixed(2));
  }

  /**
   * Build análise prompt avançada, incluindo contexto de destino/segmentação/criativo
   */
  private buildAdvancedPrompt(
    request: OpenAIInsightRequest,
    currentSummary: MetricsSummary,
    previousSummary: MetricsSummary | null
  ): string {
    const ctx = request.context || {};
    const destinationLabel = ctx.destination_type
      ? DESTINATION_LABELS[ctx.destination_type] || ctx.destination_type
      : 'Não informado (sincronize a campanha para capturar isso)';

    let prompt = `
CAMPANHA: ${request.campaign_name}
PLATAFORMA: ${request.platform.toUpperCase()}
PERÍODO ANALISADO: ${request.period_label || `${currentSummary.daysActive} dias com dados`} (${currentSummary.daysActive} dia(s) com dados registrados nesse intervalo)

=== CONTEXTO DA CAMPANHA (o que ela realmente é) ===
Objetivo declarado: ${ctx.objective || 'não informado'}
Destino do anúncio: ${destinationLabel}
Meta de otimização: ${ctx.optimization_goal || 'não informado'}
Evento de cobrança: ${ctx.billing_event || 'não informado'}
Orçamento diário: ${ctx.daily_budget ? `R$ ${(ctx.daily_budget / 100).toFixed(2)}` : 'não informado'}
Quantidade de anúncios ativos: ${ctx.total_ads ?? 'não informado'}
Segmentação/criativo coletados do Meta em: ${ctx.last_synced_at ? new Date(ctx.last_synced_at).toLocaleString('pt-BR') : 'não informado'} (se o usuário alterou a campanha no Gerenciador de Anúncios DEPOIS dessa data/hora, essa mudança ainda não está refletida aqui - seria necessário sincronizar de novo)`;

    if (ctx.targeting_summary) {
      const t = ctx.targeting_summary;
      const multipleAdSetsNote = (ctx.active_ad_sets_count ?? 1) > 1
        ? `\nATENÇÃO: esta campanha tem ${ctx.active_ad_sets_count} conjuntos de anúncios ATIVOS simultaneamente - a segmentação abaixo é só do conjunto editado mais recentemente, outros conjuntos ativos podem ter públicos diferentes. Não generalize essa segmentação como "a campanha inteira".`
        : '';
      prompt += `

=== SEGMENTAÇÃO (público-alvo configurado) ===${multipleAdSetsNote}
Idade: ${t.age_min ?? '?'} a ${t.age_max ?? '?'} anos
Gêneros: ${t.genders && t.genders.length ? t.genders.map(g => g === 1 ? 'Homens' : g === 2 ? 'Mulheres' : 'Outro').join(', ') : 'Todos'}
Localização: ${t.geo_locations && t.geo_locations.length ? t.geo_locations.join(', ') : 'não informado'}
Interesses segmentados: ${t.interests && t.interests.length ? t.interests.join(', ') : 'sem segmentação por interesse (público amplo, ou "Advantage+ Audience" com expansão automática ativada)'}
Públicos customizados: ${t.custom_audiences && t.custom_audiences.length ? t.custom_audiences.join(', ') : 'nenhum'}`;
    }

    if (ctx.creative_summary && (ctx.creative_summary.body || ctx.creative_summary.title)) {
      const c = ctx.creative_summary;
      prompt += `

=== CRIATIVO DO ANÚNCIO ATIVO (o que o usuário vê) ===
Título: ${c.title || '(sem título)'}
Texto do anúncio: ${c.body || '(sem corpo de texto capturado)'}
Call-to-action: ${c.call_to_action || 'não informado'}
Formato: ${c.format || 'não informado'}
Destino do clique: ${c.destination_url || destinationLabel}`;
    }

    prompt += `

=== MÉTRICAS ATUAIS ===
Gasto Total: R$ ${currentSummary.totalSpend.toFixed(2)}
Impressões: ${currentSummary.totalImpressions.toLocaleString()}
Alcance: ${currentSummary.totalReach.toLocaleString()}
Frequência média: ${currentSummary.avgFrequency}x (quantas vezes a mesma pessoa viu o anúncio)
Cliques: ${currentSummary.totalClicks.toLocaleString()}
CTR (Click-Through Rate): ${currentSummary.avgCTR.toFixed(2)}%
CPC (Custo por Clique): R$ ${currentSummary.avgCPC.toFixed(2)}
Conversões (${destinationLabel}): ${currentSummary.totalConversions}
${currentSummary.avgCPA ? `Custo por conversão: R$ ${currentSummary.avgCPA.toFixed(2)}` : 'Custo por conversão: não calculável (zero conversões no período)'}`;

    const actionEntries = Object.entries(currentSummary.actionsBreakdown).filter(([type]) => type !== 'link_click');
    if (actionEntries.length > 0) {
      prompt += `

=== DETALHAMENTO DE AÇÕES CAPTURADAS PELO META (use para confirmar o que está realmente convertendo) ===
${actionEntries.map(([type, value]) => `- ${type}: ${value}`).join('\n')}`;
    }

    if (previousSummary) {
      const spendVar = this.calculateVariation(currentSummary.totalSpend, previousSummary.totalSpend);
      const ctrVar = this.calculateVariation(currentSummary.avgCTR, previousSummary.avgCTR);
      const convVar = this.calculateVariation(currentSummary.totalConversions, previousSummary.totalConversions);
      const cpaVar = currentSummary.avgCPA && previousSummary.avgCPA
        ? this.calculateVariation(currentSummary.avgCPA, previousSummary.avgCPA)
        : null;

      prompt += `

=== COMPARAÇÃO COM PERÍODO ANTERIOR (${request.previous_period_label || 'período imediatamente anterior, mesma duração'}) ===
Gasto: ${spendVar > 0 ? '+' : ''}${spendVar}%
CTR: ${ctrVar > 0 ? '+' : ''}${ctrVar}%
Conversões: ${convVar > 0 ? '+' : ''}${convVar}%
${cpaVar !== null ? `Custo por conversão: ${cpaVar > 0 ? '+' : ''}${cpaVar}%` : ''}
Use essa comparação para dizer se a campanha está melhorando, piorando ou estável - e se alguma mudança recente de segmentação/criativo/orçamento já aparenta ter efeito.`;
    } else {
      prompt += `

=== COMPARAÇÃO COM PERÍODO ANTERIOR ===
Não disponível (sem dados suficientes no período anterior para comparar). Avise que a avaliação de tendência fica limitada sem esse comparativo.`;
    }

    prompt += `

=== TAREFA ===
Analise esta campanha como um media buyer especialista analisaria, levando em conta TODO o contexto acima (destino do anúncio, segmentação, criativo) - não apenas os números isolados. Gere de 3 a 5 insights estruturados e priorizados pelo impacto no resultado do negócio. Para cada insight, forneça:
1. Um título claro e direto
2. Uma descrição que conecta o número ao contexto (ex: "para uma campanha de WhatsApp, CTR de X% é/não é um problema porque...")
3. Uma ação recomendada específica, prática e implementável hoje
4. Um score de confiança (0-100) baseado na quantidade e qualidade dos dados disponíveis

IMPORTANTE: Forneça APENAS um objeto JSON válido, sem texto adicional, sem markdown.

Formato esperado:
{
  "insights": [
    {
      "title": "título curto e direto",
      "description": "análise contextualizada com os números reais",
      "recommended_action": "passos concretos e específicos",
      "confidence": 85
    }
  ]
}

Lembre-se: se o destino é WhatsApp/Messenger, NÃO compare CTR ou CPA com benchmarks de e-commerce. Se a segmentação é muito ampla ou muito restrita para o objetivo, aponte isso. Se o criativo (texto) não foi capturado, diga que a análise de copy ficou limitada.

ATENÇÃO AO PERÍODO: o Meta Ads leva de 24 a 72h para sair da fase de aprendizagem e estabilizar a entrega depois de uma mudança de segmentação, orçamento ou criativo. Se o período analisado tiver poucos dias (menos de 3-4 dias com dados) desde a data de sincronização informada acima, deixe claro que ainda é cedo para avaliar o efeito de qualquer mudança recente, em vez de dar um veredito definitivo.`;

    return prompt;
  }

  /**
   * Parse OpenAI response into insights
   */
  private parseInsights(content: string, campaignName: string): CampaignInsight[] {
    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('No JSON found in response:', content);
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const insights = parsed.insights || [];

      if (!Array.isArray(insights) || insights.length === 0) {
        throw new Error('Invalid insights array in response');
      }

      return insights.map((insight: any) => ({
        insight_type: this.categorizeInsight(insight.title),
        title: insight.title || 'Análise',
        description: insight.description || '',
        recommended_action: insight.recommended_action || '',
        confidence: Math.min(100, Math.max(0, insight.confidence || 75)),
        data: {
          campaign_name: campaignName,
          generated_at: new Date().toISOString(),
        },
      }));
    } catch (error) {
      console.error('Error parsing insights:', error);
      // Return a default insight if parsing fails
      return [
        {
          insight_type: 'performance',
          title: 'Análise Concluída',
          description: 'A análise foi processada pela IA. Se os dados estiverem incompletos, sincronize novamente.',
          recommended_action: 'Verifique se os dados das campanhas foram sincronizados corretamente.',
          confidence: 60,
          data: {
            campaign_name: campaignName,
            error: String(error),
          },
        },
      ];
    }
  }

  /**
   * Categorize insight based on title keywords
   */
  private categorizeInsight(title: string): string {
    const titleLower = title.toLowerCase();

    if (titleLower.includes('ctr') || titleLower.includes('clique') || titleLower.includes('engajamento')) {
      return 'engagement';
    }
    if (titleLower.includes('cpc') || titleLower.includes('custo') || titleLower.includes('orçamento')) {
      return 'cost_efficiency';
    }
    if (titleLower.includes('conversão') || titleLower.includes('roi') || titleLower.includes('roas') || titleLower.includes('conversa')) {
      return 'conversion';
    }
    if (titleLower.includes('público') || titleLower.includes('segmentação') || titleLower.includes('targeting')) {
      return 'audience';
    }
    if (titleLower.includes('criativo') || titleLower.includes('copy') || titleLower.includes('anúncio')) {
      return 'creative';
    }
    if (titleLower.includes('trend') || titleLower.includes('padrão') || titleLower.includes('comportamento') || titleLower.includes('frequência')) {
      return 'trend';
    }
    return 'performance';
  }
}
