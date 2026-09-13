import { requireAuth } from './_auth.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const DIAGNOSTIC_TOOL = {
  name: 'renvoyer_diagnostic',
  description: "Renvoie le diagnostic technique structuré d'une ronde de maintenance sur sous-station de chauffage urbain.",
  input_schema: {
    type: 'object',
    properties: {
      diagnostics: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: "Le contrôle concerné, repris tel quel." },
            cause_probable: { type: 'string' },
            action_recommandee: { type: 'string' },
            urgence: { type: 'string', enum: ['immediat', 'a_planifier', 'a_surveiller'] },
            escalade: { type: 'boolean', description: 'true si la panne dépasse une intervention terrain standard.' },
          },
          required: ['label', 'cause_probable', 'action_recommandee', 'urgence', 'escalade'],
        },
      },
      synthese_croisee: {
        type: ['string', 'null'],
        description: "Si plusieurs anomalies suggèrent une cause commune, l'expliquer ici. Sinon null.",
      },
    },
    required: ['diagnostics', 'synthese_croisee'],
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAuth(req, res);
  if (!user) return;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: "Diagnostic IA non configuré (ANTHROPIC_API_KEY manquant)" });
  }

  try {
    const { substation_name, anomalies } = req.body;

    if (!Array.isArray(anomalies) || anomalies.length === 0) {
      return res.status(400).json({ error: 'anomalies (tableau non vide) requis' });
    }

    const anomaliesText = anomalies
      .map((a) => `- ${a.label} [${a.status}]${a.comment ? ` : ${a.comment}` : ''}`)
      .join('\n');

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system:
          "Tu es un ingénieur maintenance expert des sous-stations d'échange de chauffage urbain (réseau eau chaude, échangeurs, vannes, instrumentation, régulation). " +
          "Un technicien vient de faire une ronde d'inspection et a relevé des anomalies. Pour chacune, donne un diagnostic technique concret et actionnable, en français, sans blabla. " +
          "Reste prudent : si l'information est insuffisante pour trancher, dis-le et recommande la vérification la plus utile plutôt que d'inventer.",
        messages: [
          {
            role: 'user',
            content: `Sous-station : ${substation_name || 'inconnue'}\n\nAnomalies relevées lors de la ronde :\n${anomaliesText}`,
          },
        ],
        tools: [DIAGNOSTIC_TOOL],
        tool_choice: { type: 'tool', name: 'renvoyer_diagnostic' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return res.status(502).json({ error: 'Le service de diagnostic IA est momentanément indisponible' });
    }

    const data = await response.json();
    const toolUse = data.content?.find((block) => block.type === 'tool_use');

    if (!toolUse) {
      return res.status(502).json({ error: "Réponse IA inexploitable" });
    }

    return res.json({ ok: true, ...toolUse.input });
  } catch (error) {
    console.error('Diagnostic error:', error);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
