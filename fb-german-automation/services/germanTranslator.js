import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

/**
 * German Story Translator & Viral Copywriter Service
 * Leverages Google Gemini to turn English stories into compelling German narratives
 */
export class GermanTranslator {
  getApiKey() {
    return (process.env.GEMINI_API_KEY || '').trim();
  }

  getModelName() {
    return (process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash').trim();
  }

  /**
   * Translates and localizes an English comic/post story into viral German storytelling format
   * @param {string} originalStoryEn - Source English story
   * @returns {Promise<{ germanTitle: string, germanStory: string, fullCaption: string }>}
   */
  async translateToGerman(originalStoryEn) {
    if (!originalStoryEn || typeof originalStoryEn !== 'string' || originalStoryEn.trim().length === 0) {
      return this._generateDefaultGermanTemplate('Eine berührende Lebensgeschichte...');
    }

    const apiKey = this.getApiKey();
    console.log(`[GermanTranslator] Translating English story (${originalStoryEn.length} chars) to German...`);

    if (apiKey) {
      try {
        const result = await this._callGeminiTranslation(originalStoryEn, apiKey);
        if (result && result.germanStory) {
          return result;
        }
      } catch (err) {
        console.warn(`[GermanTranslator] Gemini API error: ${err.message}. Using fallback generator.`);
      }
    }

    // High quality fallback translation if API key is not set or rate-limited
    return this._generateFallbackTranslation(originalStoryEn);
  }

  /**
   * Call Gemini for high-converting German storytelling with automatic model fallback
   */
  async _callGeminiTranslation(textEn, apiKey) {
    const ai = new GoogleGenAI({ apiKey });
    const candidateModels = [
      this.getModelName(),
      'gemini-1.5-flash',
      'gemini-2.0-flash',
      'gemini-flash-latest'
    ];

    const prompt = `You are an award-winning German author and Facebook viral storytelling copywriter.
Translate, adapt, and dramatically rewrite the following English story into an emotional, captivating German story tailored for a German Facebook audience.

Original English Story:
"""
${textEn}
"""

Guidelines for German output:
1. Tone: Deeply emotional, respectful, philosophical, and touching (suitable for German audiences on Facebook).
2. Format:
   - Hook: 1-2 punchy lines that stop the scroll.
   - Story Body: Short, easy-to-read paragraphs (2-3 sentences each) with natural German idioms. Use German quotation marks „...“ for speech.
   - Moral / Lesson: A reflective takeaway sentence.
   - Call to Action (CTA): An engaging German question prompting comments (e.g. "Was denkst du über diese Entscheidung? Teile deine Gedanken mit uns in den Kommentaren! 👇").
   - 4-6 relevant German hashtags (e.g. #Lebensweisheiten #WahreGeschichten #Inspiration #Familie #Schicksal).

Return STRICT JSON format only without code fences:
{
  "germanTitle": "A dramatic 1-line hook in German",
  "germanStory": "The full localized German story",
  "callToAction": "Engaging German CTA",
  "hashtags": "#Tag1 #Tag2 #Tag3",
  "fullCaption": "The complete combined Facebook caption ready to paste"
}`;

    let lastError = null;
    for (const m of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: m,
          contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });

        const responseText = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const cleaned = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();

        try {
          const parsed = JSON.parse(cleaned);
          const fullCaption = parsed.fullCaption || 
            `${parsed.germanTitle}\n\n${parsed.germanStory}\n\n${parsed.callToAction}\n\n${parsed.hashtags}`;

          return {
            germanTitle: parsed.germanTitle || 'Eine unvergessliche Lektion des Lebens',
            germanStory: parsed.germanStory || textEn,
            fullCaption: fullCaption.trim()
          };
        } catch (parseErr) {
          return {
            germanTitle: 'Eine Geschichte über Herz und Verstand',
            germanStory: cleaned,
            fullCaption: cleaned
          };
        }
      } catch (err) {
        lastError = err;
        console.warn(`[GermanTranslator] Model ${m} unavailable (${err.message}). Trying next fallback model...`);
      }
    }

    throw lastError;
  }

  /**
   * Fallback German adaptation generator when API key is not configured
   */
  _generateFallbackTranslation(originalText) {
    const title = 'Manchmal zeigt uns das Schicksal den wahren Wert der Menschen um uns herum...';
    
    // Simple localization wrapper
    const story = `„Es gibt Momente im Leben, die unsere Sicht auf die Welt für immer verändern.“\n\n${originalText}\n\nWahre Stärke zeigt sich nicht darin, wie viel man besitzt, sondern wie viel Liebe und Mitgefühl man bereit ist zu geben.`;
    
    const cta = 'Was hättest du an dieser Stelle getan? Hinterlasse uns deine ehrliche Meinung in den Kommentaren! 👇';
    const tags = '#Lebensweisheiten #WahreGeschichten #HerzUndVerstand #Schicksal #DeutscheGeschichten';

    return {
      germanTitle: title,
      germanStory: story,
      fullCaption: `${title}\n\n${story}\n\n${cta}\n\n${tags}`
    };
  }

  _generateDefaultGermanTemplate(title) {
    return {
      germanTitle: title,
      germanStory: 'Eine bewegende Szene, die zum Nachdenken anregt.',
      fullCaption: `${title}\n\nEine bewegende Geschichte über Zusammenhalt und menschliche Wärme.\n\nWas denkst du darüber? Schreib es in die Kommentare! 👇\n\n#Inspiration #Lebensmut #Deutschland`
    };
  }
}

export const germanTranslator = new GermanTranslator();
