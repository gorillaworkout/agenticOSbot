# Graph Report - .  (2026-06-24)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 702 nodes · 2188 edges · 53 communities (27 shown, 26 thin omitted)
- Extraction: 93% EXTRACTED · 7% INFERRED · 0% AMBIGUOUS · INFERRED: 156 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `23bc740d`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_API Request Handling|API Request Handling]]
- [[_COMMUNITY_Tool Execution Engine|Tool Execution Engine]]
- [[_COMMUNITY_Chat Message Processing|Chat Message Processing]]
- [[_COMMUNITY_Lark API Integration|Lark API Integration]]
- [[_COMMUNITY_Database and Error Logging|Database and Error Logging]]
- [[_COMMUNITY_Microsoft 365 Integration|Microsoft 365 Integration]]
- [[_COMMUNITY_Project Core Dependencies|Project Core Dependencies]]
- [[_COMMUNITY_TypeScript Compiler Configuration|TypeScript Compiler Configuration]]
- [[_COMMUNITY_System Type Definitions|System Type Definitions]]
- [[_COMMUNITY_Development Dependencies|Development Dependencies]]
- [[_COMMUNITY_Dashboard UI Components|Dashboard UI Components]]
- [[_COMMUNITY_User Authentication Methods|User Authentication Methods]]
- [[_COMMUNITY_Web App Manifest Configuration|Web App Manifest Configuration]]
- [[_COMMUNITY_Cryptography API Routes|Cryptography API Routes]]
- [[_COMMUNITY_NPM Package Configuration|NPM Package Configuration]]
- [[_COMMUNITY_Personal Profile Information|Personal Profile Information]]
- [[_COMMUNITY_Report Generation API|Report Generation API]]
- [[_COMMUNITY_Root Application Layout|Root Application Layout]]
- [[_COMMUNITY_Chat Interface Components|Chat Interface Components]]
- [[_COMMUNITY_Project Documentation Assets|Project Documentation Assets]]
- [[_COMMUNITY_Application Architecture Components|Application Architecture Components]]
- [[_COMMUNITY_Routing and Auth Middleware|Routing and Auth Middleware]]
- [[_COMMUNITY_Bot Capabilities Interface|Bot Capabilities Interface]]
- [[_COMMUNITY_Model Selector Component|Model Selector Component]]
- [[_COMMUNITY_Chat Sidebar Component|Chat Sidebar Component]]
- [[_COMMUNITY_Project Markdown Documentation|Project Markdown Documentation]]
- [[_COMMUNITY_PWA Metadata Configuration|PWA Metadata Configuration]]
- [[_COMMUNITY_PWA Install Prompt Component|PWA Install Prompt Component]]
- [[_COMMUNITY_ESLint Configuration|ESLint Configuration]]
- [[_COMMUNITY_Proactive Cron Script|Proactive Cron Script]]
- [[_COMMUNITY_Proactive Reminder Script|Proactive Reminder Script]]
- [[_COMMUNITY_Next.js Configuration|Next.js Configuration]]
- [[_COMMUNITY_PostCSS Configuration|PostCSS Configuration]]
- [[_COMMUNITY_Service Worker Assets|Service Worker Assets]]
- [[_COMMUNITY_Data Description|Data Description]]
- [[_COMMUNITY_File Icon Asset|File Icon Asset]]
- [[_COMMUNITY_Globe Icon Asset|Globe Icon Asset]]
- [[_COMMUNITY_Small App Icon Asset|Small App Icon Asset]]
- [[_COMMUNITY_Large App Icon Asset|Large App Icon Asset]]
- [[_COMMUNITY_Learning Instructions|Learning Instructions]]
- [[_COMMUNITY_QR Bot Final Image|QR Bot Final Image]]
- [[_COMMUNITY_QR Bot Image Asset|QR Bot Image Asset]]
- [[_COMMUNITY_QR Bot Manual Image|QR Bot Manual Image]]
- [[_COMMUNITY_QR Bot Reauth Image|QR Bot Reauth Image]]
- [[_COMMUNITY_QR Code CLI Image|QR Code CLI Image]]
- [[_COMMUNITY_QR Code CLI Public Image|QR Code CLI Public Image]]
- [[_COMMUNITY_Window Icon Asset|Window Icon Asset]]

## God Nodes (most connected - your core abstractions)
1. `authenticateRequest()` - 165 edges
2. `requireAuth()` - 164 edges
3. `ok()` - 124 edges
4. `getOne()` - 117 edges
5. `err()` - 116 edges
6. `query()` - 90 edges
7. `executeTool()` - 87 edges
8. `getMany()` - 80 edges
9. `parseBody()` - 53 edges
10. `parseSearchParams()` - 39 edges

## Surprising Connections (you probably didn't know these)
- `Next.js Logo SVG` --conceptually_related_to--> `Next.js`  [INFERRED]
  public/next.svg → README.md
- `Vercel Logo SVG` --conceptually_related_to--> `Vercel`  [INFERRED]
  public/vercel.svg → README.md
- `DELETE()` --calls--> `query()`  [INFERRED]
  src/app/api/aggregations/[id]/route.ts → src/lib/db.ts
- `POST()` --calls--> `query()`  [INFERRED]
  src/app/api/aggregations/[id]/run/route.ts → src/lib/db.ts
- `DELETE()` --calls--> `query()`  [INFERRED]
  src/app/api/alerts/[id]/route.ts → src/lib/db.ts

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Bayu Darmawan Knowledge Graph** — bayu_darmawan_person, bayu_hobi_basket_note, bayu_hobi_ngoding_jazz_note, cv_bayu_darmawan_note, bayu_darmawan_profile [INFERRED 0.95]
- **Live Meeting Translator Tech Stack** — prd_live_meeting_translator_doc, prd_openclaw, prd_whisper, prd_edge_tts, prd_postgresql [EXTRACTED 0.90]

## Communities (53 total, 26 thin omitted)

### Community 0 - "API Request Handling"
Cohesion: 0.06
Nodes (125): GET(), CreateAggSchema, GET(), POST(), CreateAlertSchema, GET(), POST(), GET() (+117 more)

### Community 1 - "Tool Execution Engine"
Cohesion: 0.07
Nodes (70): analyticsQuery(), calculator(), currentTime(), errorLogsSearch(), executeTool(), generatePdf(), getLarkProfile(), getToolByName() (+62 more)

### Community 2 - "Chat Message Processing"
Cohesion: 0.07
Nodes (56): ChatSchema, parseToolCallsFromResponse(), POST(), handleCalendarEvent(), handleCardAction(), isDuplicate(), log, parseToolCallsFromResponse() (+48 more)

### Community 3 - "Lark API Integration"
Cohesion: 0.07
Nodes (54): GET(), GET(), ActionSchema, GET(), POST(), getLarkToken(), getLarkUserToken(), getLarkUserTokenFromDB() (+46 more)

### Community 4 - "Database and Error Logging"
Cohesion: 0.06
Nodes (50): execAsync, GET(), log, POST(), GET(), log, GET(), log (+42 more)

### Community 5 - "Microsoft 365 Integration"
Cohesion: 0.12
Nodes (28): GET(), GET(), SendSchema, getConfig(), getMs365Token(), graphFetch(), Ms365Config, ms365CreateEvent() (+20 more)

### Community 6 - "Project Core Dependencies"
Cohesion: 0.07
Nodes (27): dependencies, bcryptjs, cors, csv-parse, d3, gray-matter, ioredis, jsonwebtoken (+19 more)

### Community 7 - "TypeScript Compiler Configuration"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 8 - "System Type Definitions"
Cohesion: 0.12
Nodes (16): AgentStatus, AgentStep, ApiResponse, ChatMessage, IntegrationConfig, IntegrationType, LLMOptions, LLMResponse (+8 more)

### Community 9 - "Development Dependencies"
Cohesion: 0.13
Nodes (15): devDependencies, eslint, eslint-config-next, tailwindcss, @tailwindcss/postcss, @types/bcryptjs, @types/cors, @types/jsonwebtoken (+7 more)

### Community 10 - "Dashboard UI Components"
Cohesion: 0.15
Nodes (4): Feature, FEATURES, Note, VaultStats

### Community 11 - "User Authentication Methods"
Cohesion: 0.24
Nodes (10): ChangePasswordSchema, POST(), generateToken(), hashPassword(), verifyPassword(), LoginSchema, POST(), UserRow (+2 more)

### Community 12 - "Web App Manifest Configuration"
Cohesion: 0.18
Nodes (10): background_color, categories, description, display, icons, name, orientation, short_name (+2 more)

### Community 13 - "Cryptography API Routes"
Cohesion: 0.31
Nodes (6): DELETE(), execAsync, GET(), log, POST(), encrypt()

### Community 14 - "NPM Package Configuration"
Cohesion: 0.22
Nodes (8): name, private, scripts, build, dev, lint, start, version

### Community 15 - "Personal Profile Information"
Cohesion: 0.32
Nodes (8): Bayu Darmawan, Bayu Darmawan - Profil, Bayu - Hobi Basket, Bayu - Hobi Ngoding Jazz, CV Bayu Darmawan, Dupoin, Lark, Uxbee

### Community 16 - "Report Generation API"
Cohesion: 0.43
Nodes (5): generateActivityReport(), generatePerformanceReport(), generateUsageReport(), POST(), ReportConfig

### Community 17 - "Root Application Layout"
Cohesion: 0.40
Nodes (3): inter, jetbrains, metadata

### Community 20 - "Project Documentation Assets"
Cohesion: 0.40
Nodes (4): Next.js Logo SVG, Next.js, Vercel, Vercel Logo SVG

### Community 21 - "Application Architecture Components"
Cohesion: 0.40
Nodes (5): Edge-TTS, PRD: Live Meeting Translator, OpenClaw, PostgreSQL Database, Whisper STT

### Community 22 - "Routing and Auth Middleware"
Cohesion: 0.40
Nodes (3): config, PROTECTED_PREFIXES, PUBLIC_PREFIXES

## Knowledge Gaps
- **212 isolated node(s):** `eslintConfig`, `nextConfig`, `name`, `version`, `private` (+207 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **26 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `getOne()` connect `API Request Handling` to `Tool Execution Engine`, `Chat Message Processing`, `Lark API Integration`, `Database and Error Logging`, `Microsoft 365 Integration`, `User Authentication Methods`, `Cryptography API Routes`, `Report Generation API`?**
  _High betweenness centrality (0.087) - this node is a cross-community bridge._
- **Why does `query()` connect `Database and Error Logging` to `API Request Handling`, `Tool Execution Engine`, `Chat Message Processing`, `Cryptography API Routes`, `Report Generation API`?**
  _High betweenness centrality (0.053) - this node is a cross-community bridge._
- **Why does `authenticateRequest()` connect `API Request Handling` to `Chat Message Processing`, `Lark API Integration`, `Database and Error Logging`, `Microsoft 365 Integration`, `User Authentication Methods`, `Report Generation API`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Are the 40 inferred relationships involving `authenticateRequest()` (e.g. with `GET()` and `GET()`) actually correct?**
  _`authenticateRequest()` has 40 INFERRED edges - model-reasoned connections that need verification._
- **Are the 40 inferred relationships involving `requireAuth()` (e.g. with `GET()` and `GET()`) actually correct?**
  _`requireAuth()` has 40 INFERRED edges - model-reasoned connections that need verification._
- **Are the 24 inferred relationships involving `getOne()` (e.g. with `GET()` and `GET()`) actually correct?**
  _`getOne()` has 24 INFERRED edges - model-reasoned connections that need verification._
- **What connects `eslintConfig`, `nextConfig`, `name` to the rest of the system?**
  _212 weakly-connected nodes found - possible documentation gaps or missing edges._