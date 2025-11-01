const axios = require('axios');

exports.translateText = async (req, res) => {
  const { text, target } = req.body;
  if (!text || !target) return res.status(400).json({ error: 'Missing text or target language' });

  try {
    const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;

    // If no API key configured, gracefully return original text to avoid breaking chat flow
    if (!apiKey) {
      return res.status(200).json({ translation: text, fallback: true, reason: 'NO_API_KEY' });
    }

    const url = `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`;
    const response = await axios.post(url, {
      q: text,
      target,
      format: 'text'
    });
    return res.json({ translation: response.data.data.translations[0].translatedText });
  } catch (err) {
    // Best-effort fallback to LibreTranslate (public instances) if Google fails
    try {
      const lt = await axios.post('https://libretranslate.de/translate', {
        q: text,
        source: 'auto',
        target,
        format: 'text'
      }, {
        timeout: 5000,
        headers: { 'accept': 'application/json' }
      });
      return res.status(200).json({ translation: lt.data?.translatedText || text, fallback: true, provider: 'libretranslate' });
    } catch (fallbackErr) {
      // Last resort: return original text with 200 to keep UX smooth
      return res.status(200).json({ translation: text, fallback: true, reason: 'FALLBACK_ORIGINAL' });
    }
  }
}; 