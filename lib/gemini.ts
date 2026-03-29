import { GoogleGenAI, Type } from '@google/genai'

export interface ParsedEvent {
  ical_uid: string
  title: string
  description: string
  due_date: string
}

export interface CategorizedEvent extends ParsedEvent {
  class_name: string
  assignment_type: string
}

const BATCH_SIZE = 20

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const geminiConfig = {
  responseMimeType: 'application/json',
  responseSchema: {
    type: Type.ARRAY,
    items: {
      type: Type.OBJECT,
      properties: {
        ical_uid: { type: Type.STRING },
        class_name: { type: Type.STRING },
        assignment_type: {
          type: Type.STRING,
          enum: ['Homework', 'Test', 'Quiz', 'Reading', 'Project', 'Lab', 'Other'],
        },
      },
      required: ['ical_uid', 'class_name', 'assignment_type'],
    },
  },
}

export async function categorizeEvents(events: ParsedEvent[]): Promise<CategorizedEvent[]> {
  console.log('GEMINI_API_KEY defined:', !!process.env.GEMINI_API_KEY)

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY environment variable is not set')
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function callGeminiWithRetry(prompt: string, config: any, retries = 1): Promise<any> {
    try {
      return await ai.models.generateContent({ model: 'gemini-2.0-flash', contents: prompt, config })
    } catch (error: unknown) {
      if ((error as { status?: number })?.status === 429 && retries > 0) {
        console.log('Gemini rate limited, retrying in 2s...')
        await sleep(2000)
        return callGeminiWithRetry(prompt, config, retries - 1)
      }
      throw error
    }
  }

  // Build batches and process sequentially to avoid rate limits
  const batches: ParsedEvent[][] = []
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    batches.push(events.slice(i, i + BATCH_SIZE))
  }

  const allResults: Array<{ ical_uid: string; class_name: string; assignment_type: string }> = []

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]
    const prompt = `You are a school assignment categorizer. For each assignment below, infer:
1. class_name: the subject or class (e.g. "Spanish", "AP Biology", "Algebra 2"). Use the title and description as clues.
2. assignment_type: pick exactly one from [Homework, Test, Quiz, Reading, Project, Lab, Other].

Return a JSON array with one object per assignment, echoing the ical_uid so results can be matched.

Assignments:
${batch.map((e) => `- uid: ${e.ical_uid}\n  title: ${e.title}\n  description: ${e.description || '(none)'}`).join('\n')}
`

    try {
      const response = await callGeminiWithRetry(prompt, geminiConfig)
      const text = response.text
      console.log('[gemini] raw response text:', text)
      if (!text) {
        throw new Error('Gemini returned an empty response')
      }
      const parsed = JSON.parse(text)
      allResults.push(...parsed)
    } catch (error) {
      console.error('Gemini error full:', JSON.stringify(error, null, 2))
      console.error('Gemini error message:', (error as { message?: string })?.message)
      console.error('Gemini error status:', (error as { status?: number })?.status)
      throw error
    }

    // Wait 1 second between batches (except after the last one)
    if (i + BATCH_SIZE < events.length) {
      await sleep(1000)
    }
  }

  const resultMap = new Map(allResults.map((r) => [r.ical_uid, r]))

  return events.map((event) => {
    const match = resultMap.get(event.ical_uid)
    return {
      ...event,
      class_name: match?.class_name ?? 'Unknown',
      assignment_type: match?.assignment_type ?? 'Other',
    }
  })
}
