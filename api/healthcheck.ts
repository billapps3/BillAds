// Healthcheck to keep Supabase project alive
// This runs daily via Vercel Cron to prevent project pause on free tier

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || '';

export default async function handler(req: any, res: any) {
  try {
    // Only allow requests from Vercel Cron
    if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Simple query to keep the project active
    const { data, error } = await supabase
      .from('integrations')
      .select('id')
      .limit(1);

    if (error) {
      console.error('Healthcheck error:', error);
      return res.status(500).json({ error: error.message });
    }

    console.log('Healthcheck passed - Supabase project is active');
    return res.status(200).json({
      success: true,
      message: 'Supabase project is alive',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Healthcheck failed:', err);
    return res.status(500).json({ error: String(err) });
  }
}
