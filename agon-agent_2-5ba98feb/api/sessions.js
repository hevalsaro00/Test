import supabase from './db-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    if (req.method === 'GET') {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('pomodoro_sessions')
        .select('*')
        .gte('completed_at', startOfDay.toISOString())
        .order('completed_at', { ascending: false });
      if (error) throw error;
      const focusCount = data.filter((s) => s.mode === 'focus').length;
      const focusMinutes = data
        .filter((s) => s.mode === 'focus')
        .reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
      return res.status(200).json({ sessions: data, focusCount, focusMinutes });
    }
    if (req.method === 'POST') {
      const { mode, duration_minutes } = req.body;
      if (!mode || !duration_minutes) {
        return res.status(400).json({ error: 'mode and duration_minutes are required' });
      }
      const { data, error } = await supabase
        .from('pomodoro_sessions')
        .insert({ mode, duration_minutes, completed_at: new Date().toISOString() })
        .select()
        .single();
      if (error) throw error;
      return res.status(201).json(data);
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('API error:', err);
    res.status(500).json({ error: err.message });
  }
}
