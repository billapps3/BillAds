import { Integration, Campaign, DailyMetrics, APIResponse } from '@/types/ads';

const META_GRAPH_API_VERSION = 'v19.0';
const META_BASE_URL = 'https://graph.facebook.com';

export class MetaAdsService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Get user's ad accounts
   */
  async getAdAccounts(): Promise<APIResponse<any[]>> {
    try {
      const fields = 'id,name,account_status,currency,timezone_name,business_name';
      const response = await fetch(
        `${META_BASE_URL}/${META_GRAPH_API_VERSION}/me/adaccounts?fields=${fields}&access_token=${this.accessToken}`
      );
      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error?.message };
      }

      return { success: true, data: data.data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get campaigns for an ad account
   */
  async getCampaigns(
    accountId: string,
    fields: string[] = [
      'id',
      'name',
      'status',
      'objective',
      'daily_budget',
      'lifetime_budget',
      'start_time',
      'stop_time',
    ]
  ): Promise<APIResponse<Campaign[]>> {
    try {
      const fieldString = fields.join(',');
      const response = await fetch(
        `${META_BASE_URL}/${META_GRAPH_API_VERSION}/${accountId}/campaigns?fields=${fieldString}&access_token=${this.accessToken}`
      );
      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error?.message };
      }

      return { success: true, data: data.data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get campaign insights (metrics)
   * Captura todos os tipos de "action" relevantes, não só pixel purchase -
   * campanhas de WhatsApp/Messenger/Leads usam outros action_types e antes ficavam sempre com 0 conversões.
   */
  async getCampaignInsights(
    campaignId: string,
    dateStart: string,
    dateEnd: string
  ): Promise<APIResponse<DailyMetrics[]>> {
    const CONVERSION_ACTION_TYPES = [
      'offsite_conversion.fb_pixel_purchase',
      'omni_purchase',
      'onsite_conversion.messaging_conversation_started_7d',
      'onsite_conversion.messaging_first_reply',
      'click_to_whatsapp',
      'onsite_conversion.lead_grouped',
      'lead',
      'onsite_conversion.total_messaging_connection',
      'link_click',
    ];

    try {
      const fields = [
        'campaign_id',
        'campaign_name',
        'date_start',
        'date_stop',
        'impressions',
        'clicks',
        'inline_link_clicks',
        'spend',
        'reach',
        'frequency',
        'actions',
        'action_values',
        'cost_per_action_type',
      ].join(',');

      const response = await fetch(
        `${META_BASE_URL}/${META_GRAPH_API_VERSION}/${campaignId}/insights?` +
          `fields=${fields}` +
          `&time_range={"since":"${dateStart}","until":"${dateEnd}"}` +
          `&time_increment=1` +
          `&access_token=${this.accessToken}`
      );
      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error?.message };
      }

      // Transform Meta API response to DailyMetrics
      const metrics = (data.data || []).map((item: any) => {
        const impressions = parseInt(item.impressions) || 0;
        const clicks = parseInt(item.clicks) || 0;
        const spend = parseFloat(item.spend) || 0;

        // Soma todas as actions que representam uma "conversão" para o objetivo da campanha
        // (o que conta como conversão varia: compra para e-commerce, início de conversa para WhatsApp, lead para geração de leads)
        const conversions = (item.actions || [])
          .filter((a: any) => CONVERSION_ACTION_TYPES.includes(a.action_type) && a.action_type !== 'link_click')
          .reduce((sum: number, a: any) => sum + (parseInt(a.value) || 0), 0);

        // actions "cruas" para a IA entender exatamente o que está acontecendo (ex: mensagens iniciadas no WhatsApp)
        const actionsBreakdown = (item.actions || []).map((a: any) => ({
          type: a.action_type,
          value: parseInt(a.value) || 0,
        }));

        return {
          date: item.date_start,
          impressions,
          clicks,
          conversions,
          spend,
          ctr: clicks && impressions ? (clicks / impressions) * 100 : 0,
          cpc: clicks ? spend / clicks : 0,
          reach: parseInt(item.reach) || 0,
          frequency: parseFloat(item.frequency) || 0,
          custom_metrics: { actionsBreakdown },
        };
      });

      return { success: true, data: metrics };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get ad sets for a campaign - traz destination_type (ex: WHATSAPP, WEBSITE, MESSENGER, APP),
   * optimization_goal, billing_event e targeting (público-alvo).
   */
  async getCampaignAdSets(campaignId: string): Promise<APIResponse<any[]>> {
    try {
      const fields = [
        'id',
        'name',
        'status',
        'updated_time',
        'destination_type',
        'optimization_goal',
        'billing_event',
        'bid_strategy',
        'targeting',
        'daily_budget',
        'lifetime_budget',
      ].join(',');

      const response = await fetch(
        `${META_BASE_URL}/${META_GRAPH_API_VERSION}/${campaignId}/adsets?fields=${fields}&access_token=${this.accessToken}`
      );
      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error?.message };
      }

      return { success: true, data: data.data || [] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Get ads + creatives for a campaign - traz o texto do anúncio, título, CTA e formato do criativo,
   * para a IA poder avaliar o copy, não só os números.
   * Cobre tanto criativos "diretos" (title/body) quanto anúncios que reaproveitam um post existente
   * da página (object_story_spec), que é onde o texto normalmente fica quando o formato é SHARE.
   */
  async getCampaignAds(campaignId: string): Promise<APIResponse<any[]>> {
    try {
      const fields = [
        'id',
        'name',
        'status',
        'creative{title,body,object_type,call_to_action_type,link_url,image_url,video_id,thumbnail_url,' +
          'object_story_spec{link_data{message,name,description,call_to_action{type}},video_data{message,title,call_to_action{type}}},' +
          'asset_feed_spec{bodies{text},titles{text},call_to_action_types}}',
      ].join(',');

      const response = await fetch(
        `${META_BASE_URL}/${META_GRAPH_API_VERSION}/${campaignId}/ads?fields=${fields}&access_token=${this.accessToken}`
      );
      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error?.message };
      }

      return { success: true, data: data.data || [] };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }

  /**
   * Extrai o texto/CTA real de um objeto de creative do Meta, lidando com os 3 formatos possíveis:
   * criativo direto, post existente da página (object_story_spec) ou criativo dinâmico (asset_feed_spec).
   */
  static extractCreativeText(creative: any): { title?: string; body?: string; call_to_action?: string } {
    if (!creative) return {};

    if (creative.body || creative.title) {
      return {
        title: creative.title,
        body: creative.body,
        call_to_action: creative.call_to_action_type,
      };
    }

    const linkData = creative.object_story_spec?.link_data;
    if (linkData) {
      return {
        title: linkData.name,
        body: linkData.message || linkData.description,
        call_to_action: linkData.call_to_action?.type,
      };
    }

    const videoData = creative.object_story_spec?.video_data;
    if (videoData) {
      return {
        title: videoData.title,
        body: videoData.message,
        call_to_action: videoData.call_to_action?.type,
      };
    }

    const assetFeed = creative.asset_feed_spec;
    if (assetFeed) {
      return {
        title: assetFeed.titles?.[0]?.text,
        body: assetFeed.bodies?.[0]?.text,
        call_to_action: assetFeed.call_to_action_types?.[0],
      };
    }

    return {};
  }

  /**
   * Validate access token
   */
  async validateToken(): Promise<APIResponse<boolean>> {
    try {
      const response = await fetch(
        `${META_BASE_URL}/${META_GRAPH_API_VERSION}/me?fields=id,name&access_token=${this.accessToken}`
      );
      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error?.message };
      }

      return { success: true, data: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
}
