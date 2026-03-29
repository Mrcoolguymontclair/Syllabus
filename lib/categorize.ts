import Groq from 'groq-sdk'

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

function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error('GROQ_API_KEY environment variable is not set')
  return new Groq({ apiKey })
}

export async function categorizeEvents(events: ParsedEvent[]): Promise<CategorizedEvent[]> {
  const groq = getGroqClient()
  const results: Array<{ ical_uid: string; class_name: string; assignment_type: string }> = []

  for (let i = 0; i < events.length; i += 20) {
    const batch = events.slice(i, i + 20)

    const prompt = `Categorize these school assignments. For each one, return the class subject and assignment type.

Assignments:
${batch.map((e) => `- uid: ${e.ical_uid} | title: ${e.title} | description: ${e.description}`).join('\n')}

Respond with a JSON array only, no markdown. Each item must have:
- ical_uid (string, copy exactly from input)
- class_name (string, e.g. "Spanish", "AP Biology", "Math")
- assignment_type (one of: "Homework", "Test", "Quiz", "Reading", "Project", "Lab", "Other")`

    const response = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    })

    const text = response.choices[0].message.content ?? '[]'
    const parsed: unknown = JSON.parse(text)
    // Groq may return { assignments: [...] } or just [...]
    const arr = Array.isArray(parsed) ? parsed : (Object.values(parsed as object)[0] as typeof results)
    results.push(...arr)
  }

  return events.map((e) => {
    const match = results.find((r) => r.ical_uid === e.ical_uid)
    return {
      ...e,
      class_name: match?.class_name ?? 'Unknown',
      assignment_type: match?.assignment_type ?? 'Other',
    }
  })
}
