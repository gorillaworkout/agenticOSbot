# PRD: Live Meeting Translator (Mandarin ⇄ Indonesian)

**Author:** Agentic OS Team  
**Date:** 2026-06-15  
**Status:** Draft  
**Issue:** GOR-42

---

## 1. Problem Statement

Indonesian businesses increasingly engage with Chinese partners, suppliers, and clients. Language barriers in meetings cause:
- Miscommunication in contract negotiations and technical discussions
- High cost of professional interpreters ($200-500/meeting)
- Delayed decision-making due to language processing gaps
- Lost nuance in real-time business contexts

Current solutions (Google Translate, DeepL) don't handle real-time speech well, especially for Mandarin-Indonesian pairs where translation quality is significantly lower than Mandarin-English.

## 2. Target Users

| Segment | Need | Size |
|---------|------|------|
| B2B Indonesian companies with China operations | Daily meeting translation | ~50,000 companies |
| Import/export businesses | Supplier negotiation translation | ~200,000 SMEs |
| Tech companies with Mandarin-speaking teams | Internal meeting support | ~5,000 companies |
| Government agencies (trade, investment) | Official meeting translation | ~500 agencies |
| Conference/event organizers | Simultaneous translation | ~1,000 events/year |

## 3. Core Features

### MVP (v0.1) — Text-Only Translation
- Real-time speech-to-text (Mandarin Chinese) via Whisper/Cloud STT
- Text translation via LLM (Mandarin → Indonesian, high context awareness)
- Meeting transcript display (side-by-side Mandarin/Indonesian)
- Basic speaker identification (2 speakers)
- Transcript export (text, PDF)

### v1.0 — Voice Translation
- Text-to-speech output (Indonesian voice)
- Real-time audio streaming via WebSocket
- Multi-speaker support (up to 5 speakers)
- Meeting summary generation (AI-powered)
- Meeting action items extraction
- Integration with Zoom, Google Meet (audio capture)

### v2.0 — Multi-Language & Enterprise
- Add English as third language
- Real-time subtitle overlay for video calls
- Enterprise features: team accounts, meeting archives, analytics
- Custom glossary support (industry-specific terms)
- API access for third-party integrations

## 4. Technical Architecture

```
┌─────────────────────────────────────────────────┐
│                    Client                        │
│  ┌─────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Audio   │  │Subtitle  │  │ Transcript    │  │
│  │ Capture │  │ Display  │  │ View          │  │
│  └────┬────┘  └────┬─────┘  └───────┬───────┘  │
│       │             │                │           │
│       ▼             ▼                ▼           │
│  ┌─────────────────────────────────────────┐    │
│  │         WebSocket Manager               │    │
│  └──────────────────┬──────────────────────┘    │
└─────────────────────┼───────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│              Agentic OS Backend                  │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │WebSocket │  │ Meeting  │  │  Transcript  │  │
│  │ Server   │  │ Manager  │  │  Store       │  │
│  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │              │               │           │
│       ▼              ▼               ▼           │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ STT      │  │ LLM      │  │  TTS         │  │
│  │ (Whisper)│  │Translation│  │  (Edge-TTS)  │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │ Speaker  │  │ Summary  │  │  Action      │  │
│  │ ID       │  │ Generator│  │  Extractor   │  │
│  └──────────┘  └──────────┘  └──────────────┘  │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│              PostgreSQL Database                 │
│  meetings │ meeting_segments │ meeting_summaries │
└─────────────────────────────────────────────────┘
```

## 5. API Design

### Meeting Management
- `POST /api/meetings` — Create a new meeting session
- `GET /api/meetings` — List meetings (paginated, filterable)
- `GET /api/meetings/[id]` — Get meeting details
- `DELETE /api/meetings/[id]` — Delete meeting

### Real-Time Translation
- `WebSocket /ws/meeting/[id]` — Real-time audio stream
  - Client sends: `{type: "audio", data: <base64>, timestamp: number}`
  - Server sends: `{type: "transcript", lang: "zh", text: "...", speaker: 1}`
  - Server sends: `{type: "translation", lang: "id", text: "...", speaker: 1}`
  - Server sends: `{type: "audio", data: <base64>, format: "mp3"}` (TTS output)

### Transcript & Summary
- `GET /api/meetings/[id]/segments` — Get all segments (paginated)
- `GET /api/meetings/[id]/summary` — Get AI-generated meeting summary
- `POST /api/meetings/[id]/summary` — Generate/regenerate summary
- `GET /api/meetings/[id]/actions` — Extract action items
- `GET /api/meetings/[id]/export` — Export transcript (PDF/Text)

### Settings
- `GET /api/translate/settings` — Get translation preferences
- `PUT /api/translate/settings` — Update preferences (voices, auto-summary, etc.)

## 6. Database Schema

```sql
CREATE TABLE meetings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  source_lang TEXT DEFAULT 'zh' CHECK (source_lang IN ('zh', 'id', 'en')),
  target_lang TEXT DEFAULT 'id' CHECK (target_lang IN ('zh', 'id', 'en')),
  speaker_count INT DEFAULT 2,
  settings JSONB DEFAULT '{}',
  duration_seconds INT DEFAULT 0,
  segment_count INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE meeting_segments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  speaker_id INT NOT NULL DEFAULT 1,
  source_text TEXT NOT NULL,
  source_lang TEXT NOT NULL,
  translated_text TEXT,
  translated_lang TEXT,
  audio_url TEXT,
  confidence NUMERIC(3,2),
  start_time_ms INT,
  end_time_ms INT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_segments_meeting ON meeting_segments(meeting_id, created_at ASC);

CREATE TABLE meeting_summaries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  action_items JSONB DEFAULT '[]',
  key_decisions JSONB DEFAULT '[]',
  participants JSONB DEFAULT '[]',
  generated_by TEXT DEFAULT 'ai',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

## 7. UI Wireframes

### Main Translation View
```
┌─────────────────────────────────────────────────┐
│ 🎙️ Meeting: Supplier Call - Shanghai     ⏱️ 12:34│
├─────────────────────────────────────────────────┤
│ ┌──────────────────┐ ┌──────────────────┐       │
│ │ 🇨🇳 Mandarin      │ │ 🇮🇩 Indonesian    │       │
│ │                  │ │                  │       │
│ │ [Speaker 1]      │ │ [Pembicara 1]    │       │
│ │ 你好，今天我们    │ │ Halo, hari ini    │       │
│ │ 讨论一下订单...  │ │ kita bahas       │       │
│ │                  │ │ pesanan...       │       │
│ │ [Speaker 2]      │ │ [Pembicara 2]    │       │
│ │ 好的，我同意     │ │ Oke, saya setuju │       │
│ │                  │ │                  │       │
│ └──────────────────┘ └──────────────────┘       │
├─────────────────────────────────────────────────┤
│ 🔊 [ ▶️ Play TTS]  📋 [Export]  📊 [Summary]   │
└─────────────────────────────────────────────────┘
```

### Settings Panel
```
┌─────────────────────────────────┐
│ ⚙️ Translation Settings         │
├─────────────────────────────────┤
│ Source Language: [Mandarin    ▼] │
│ Target Language: [Indonesian  ▼] │
│ Auto-summary:    [✓]            │
│ TTS Output:      [✓]            │
│ Speaker ID:      [✓]            │
│ Voice:           [Female ID  ▼]  │
│ Glossary:        [Edit...]      │
└─────────────────────────────────┘
```

## 8. Integration Points

### OpenClaw Integration
- Use OpenClaw as the AI backbone for translation
- Leverage existing LLM API (llm.mah.me) for Mandarin→Indonesian translation
- Use OpenClaw's WebSocket support for real-time streaming
- Agent memory for meeting context and glossary learning

### Audio Capture
- **Browser:** Web Audio API (microphone capture)
- **Zoom/Meet/Teams:** Audio capture via system audio loopback or browser extension
- **Mobile:** Native audio recording APIs
- Future: Direct integration via Zoom/Meet APIs (WebSocket bots)

### STT/TTS APIs
- **STT:** Whisper (local or API), Cloud Speech-to-Text (Azure/GCP)
- **TTS:** Edge-TTS (free, good quality), Azure Speech Services (premium)
- **Translation:** Custom fine-tuned model or LLM-based translation

## 9. Security & Privacy

- Audio is **not stored permanently** — only transcripts are retained
- End-to-end encryption option for sensitive meetings
- GDPR/Indonesian PDP Law compliant data handling
- Meeting access via time-limited tokens
- Option to disable cloud processing (local-only mode)
- Data retention policy: transcripts kept for 90 days by default, configurable

## 10. Competitive Analysis

| Feature | This Product | Google Translate | DeepL | Human Interpreter |
|---------|-------------|-----------------|-------|-------------------|
| Real-time speech | ✅ | ✅ (limited) | ❌ | ✅ |
| Mandarin→Indonesian | ✅ (optimized) | ⚠️ (basic) | ⚠️ (basic) | ✅ |
| Speaker ID | ✅ | ❌ | ❌ | ✅ |
| Meeting summary | ✅ | ❌ | ❌ | ✅ |
| Cost/meeting | ~$0.50 | Free (limited) | $5.49/mo | $200-500 |
| Context awareness | ✅ (LLM) | ⚠️ | ⚠️ | ✅ |
| Glossary support | ✅ | ❌ | ❌ | ✅ |
| Offline mode | ✅ (planned) | ❌ | ❌ | ✅ |

## 11. Roadmap

| Phase | Timeline | Features |
|-------|----------|----------|
| MVP | Month 1-2 | Text-only translation, basic transcript, 2 speakers |
| v1.0 | Month 3-4 | Voice output, multi-speaker, Zoom/Meet integration |
| v1.5 | Month 5-6 | Meeting summary, action items, glossary |
| v2.0 | Month 7-9 | Multi-language, enterprise features, API |
| v2.5 | Month 10-12 | Offline mode, mobile apps, advanced analytics |

## 12. Cost Estimates

### Infrastructure (Monthly)
- VPS (ARM64, 4 vCPU, 24GB RAM): $50-100/month
- PostgreSQL (existing): $0 (shared)
- STT API (Whisper): ~$0.006/minute → ~$18/hour of meetings
- TTS API (Edge-TTS): Free (or ~$0.01/1K chars for premium)
- LLM Translation: ~$0.002/1K tokens → ~$0.50/hour of meetings
- Storage (transcripts): ~$0.02/GB/month

### Per-Meeting Cost
- 1-hour meeting: ~$0.50-1.00 (STT + LLM + storage)
- vs Human interpreter: $200-500/meeting
- **99.5% cost reduction vs human interpreters**

### Pricing Model (Future SaaS)
- Free tier: 5 meetings/month (30 min each)
- Pro: $29/month (unlimited meetings, all features)
- Enterprise: Custom (on-premise, custom glossary, support)

## 13. Success Metrics

- Translation accuracy: >90% BLEU score for ZH→ID
- Latency: <2 seconds (speech → translated text)
- User satisfaction: >4.0/5.0 rating
- Meeting comprehension: >85% post-meeting quiz score
- Adoption: 100 paying customers within 6 months of v1.0

---

*This PRD defines the vision for the Live Meeting Translator. Implementation will follow the phased roadmap, starting with a text-only MVP and progressively adding voice, multi-speaker, and enterprise features.*
