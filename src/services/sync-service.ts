import { supabase } from './supabase-service';
import { MetaAdsService } from './meta-ads-service';
import { GoogleAdsService } from './google-ads-service';

export class SyncService {
  /**
   * Sync campaigns for all integrations
   */
  static async syncAllCampaigns() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Get all integrations for this user
      const { data: integrations } = await supabase
        .from('integrations')
        .select('*')
        .eq('user_id', user.id);

      if (!integrations || integrations.length === 0) {
        return { success: true, message: 'No integrations found' };
      }

      let totalCampaigns = 0;

      // Sync each integration (reuses the single-integration sync, which also pulls metrics)
      for (const integration of integrations) {
        const result = await SyncService.syncIntegrationCampaigns(integration.id);
        if (result.success) {
          const match = result.message?.match(/Synced (\d+) campaigns/);
          totalCampaigns += match ? parseInt(match[1]) : 0;
        }
      }

      return {
        success: true,
        message: `Synced ${totalCampaigns} campaigns`
      };
    } catch (error) {
      console.error('Sync error:', error);
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * Sync campaigns for a specific integration
   */
  static async syncIntegrationCampaigns(integrationId: string) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: integration } = await supabase
        .from('integrations')
        .select('*')
        .eq('id', integrationId)
        .eq('user_id', user.id)
        .single();

      if (!integration) throw new Error('Integration not found');

      if (integration.platform === 'meta') {
        const metaService = new MetaAdsService(integration.access_token);
        const campaignsResult = await metaService.getCampaigns(integration.platform_account_id);

        if (!campaignsResult.success) {
          throw new Error(campaignsResult.error);
        }

        const dateEnd = new Date().toISOString().split('T')[0];
        const dateStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        let count = 0;
        let metricsCount = 0;
        for (const campaign of campaignsResult.data || []) {
          // Para campanhas ativas, busca também destino do anúncio, segmentação e criativo
          // (contexto que a análise de IA precisa para avaliar "pra onde o tráfego vai" e "o que o anúncio diz")
          let metadata: Record<string, any> = {};
          if (campaign.status === 'ACTIVE') {
            const [adSetsResult, adsResult] = await Promise.all([
              metaService.getCampaignAdSets(campaign.id),
              metaService.getCampaignAds(campaign.id),
            ]);

            if (adSetsResult.success && adSetsResult.data && adSetsResult.data.length > 0) {
              const adSet = adSetsResult.data[0];
              const targeting = adSet.targeting || {};
              metadata.destination_type = adSet.destination_type;
              metadata.optimization_goal = adSet.optimization_goal;
              metadata.billing_event = adSet.billing_event;
              metadata.bid_strategy = adSet.bid_strategy;
              metadata.targeting_summary = {
                age_min: targeting.age_min,
                age_max: targeting.age_max,
                genders: targeting.genders,
                geo_locations: targeting.geo_locations?.cities?.map((c: any) => c.name)
                  || targeting.geo_locations?.countries
                  || targeting.geo_locations?.regions?.map((r: any) => r.name),
                interests: targeting.flexible_spec?.flatMap((f: any) => f.interests?.map((i: any) => i.name) || []),
                custom_audiences: targeting.custom_audiences?.map((a: any) => a.name),
              };
            }

            if (adsResult.success && adsResult.data && adsResult.data.length > 0) {
              const activeAd = adsResult.data.find((a: any) => a.status === 'ACTIVE') || adsResult.data[0];
              const creative = activeAd?.creative || {};
              const extracted = MetaAdsService.extractCreativeText(creative);
              metadata.creative_summary = {
                title: extracted.title,
                body: extracted.body,
                call_to_action: extracted.call_to_action,
                format: creative.object_type,
                destination_url: creative.link_url,
              };
              metadata.total_ads = adsResult.data.length;
            }
          }

          const { data: savedCampaign, error: campaignError } = await supabase
            .from('campaigns')
            .upsert({
              user_id: user.id,
              integration_id: integration.id,
              platform: 'meta',
              campaign_id: campaign.id,
              campaign_name: campaign.name,
              status: campaign.status,
              objective: campaign.objective,
              daily_budget: campaign.daily_budget,
              metadata,
              synced_at: new Date().toISOString(),
            }, {
              onConflict: 'platform,campaign_id'
            })
            .select()
            .single();

          if (campaignError || !savedCampaign) {
            console.error(`Failed to save campaign ${campaign.id}:`, campaignError);
            continue;
          }
          count++;

          // Sync daily metrics for this campaign
          const insightsResult = await metaService.getCampaignInsights(campaign.id, dateStart, dateEnd);
          if (insightsResult.success && insightsResult.data && insightsResult.data.length > 0) {
            for (const metric of insightsResult.data) {
              await supabase.from('campaign_metrics').upsert({
                campaign_id: savedCampaign.id,
                date: metric.date,
                impressions: metric.impressions,
                clicks: metric.clicks,
                conversions: metric.conversions,
                spend: metric.spend,
                ctr: metric.ctr,
                cpc: metric.cpc,
                reach: metric.reach,
                frequency: metric.frequency,
                custom_metrics: metric.custom_metrics,
              }, {
                onConflict: 'campaign_id,date'
              });
              metricsCount++;
            }
          }
        }

        // Update integration
        await supabase
          .from('integrations')
          .update({ last_sync: new Date().toISOString() })
          .eq('id', integrationId);

        return { success: true, message: `Synced ${count} campaigns, ${metricsCount} daily metrics` };
      }

      return { success: false, error: 'Platform not supported' };
    } catch (error) {
      console.error('Sync error:', error);
      return { success: false, error: String(error) };
    }
  }
}
