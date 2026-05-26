# ⚡ AI Council

Multi-model AI Council — Cloudflare R2 storage, toate tipurile de documente, fișiere multiple, chei exclusiv pe server, multi-device Supabase.

---

## 🚀 Deploy în 4 pași

### 1. GitHub
```bash
git init && git add . && git commit -m "feat: AI Council v5"
git remote add origin https://github.com/USERNAME/ai-council.git
git push -u origin main
```

### 2. Netlify
- **netlify.com** → Add new site → Import from Git → selectează repo
- Build settings: **lasă TOT GOL**
- Deploy

### 3. Netlify Environment Variables
**Site Settings → Environment Variables → Add variable**

#### AI Providers
| Variabilă | Provider |
|-----------|----------|
| `ANTHROPIC_API_KEY` | Claude (obligatoriu pentru sinteză) |
| `OPENAI_API_KEY` | GPT-4o |
| `GEMINI_API_KEY` | Gemini 2.0 Flash |
| `DEEPSEEK_API_KEY` | DeepSeek V3 |
| `XAI_API_KEY` | Grok 3 |
| `GROQ_API_KEY` | Llama 3.3 (Groq) |
| `MISTRAL_API_KEY` | Mistral Large |

#### Cloudflare R2 (fișiere mari, stocare permanentă)
| Variabilă | Unde găsești |
|-----------|-------------|
| `R2_ACCOUNT_ID` | Cloudflare Dashboard → sidebar dreapta |
| `R2_ACCESS_KEY_ID` | R2 → Manage R2 API Tokens → Create Token |
| `R2_SECRET_ACCESS_KEY` | același token |
| `R2_BUCKET_NAME` | numele bucket-ului creat |
| `R2_PUBLIC_URL` | Bucket → Settings → Public URL |

#### Supabase (DB multi-device)
| Variabilă | Unde găsești |
|-----------|-------------|
| `SUPABASE_URL` | Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Settings → API → anon public |
| `SUPABASE_SERVICE_KEY` | Settings → API → service_role |

### 4. Setup Supabase + R2

**Supabase:**
1. [supabase.com](https://supabase.com) → New Project
2. SQL Editor → copiezi `schema.sql` → Run
3. Adaugi variabilele în Netlify → Redeploy

**Cloudflare R2:**
1. [dash.cloudflare.com](https://dash.cloudflare.com) → R2 → Create bucket: `ai-council-files`
2. Bucket → Settings → activează **Public access** → copiezi Public URL
3. R2 → Manage R2 API Tokens → Create API Token (Object Read & Write pe bucket-ul tău)
4. Adaugi variabilele în Netlify → Redeploy

---

## 📁 Structura

```
ai-council/
├── index.html
├── style.css
├── app.js
├── schema.sql
├── netlify.toml
├── package.json
├── .gitignore
├── .env.example
└── netlify/functions/
    ├── config.js          # Config publică server → frontend
    ├── call-model.js      # Router AI (toate providerii + multi-file)
    ├── synthesize.js      # Moderator premium + toate tipurile doc
    ├── extract-text.js    # Extragere text din fișiere pentru context
    ├── upload-r2.js       # Presigned URL upload Cloudflare R2
    ├── delete-r2.js       # Ștergere fișier din R2
    ├── r2-sign.js         # AWS Sig V4 (no npm deps)
    └── status.js
```

---

## ✨ Features v5

| Feature | Status |
|---------|--------|
| Răspunsuri paralele N modele | ✅ |
| Sinteză Claude Sonnet 4 | ✅ |
| **Upload fișiere multiple într-un mesaj** | ✅ |
| **Cloudflare R2 — fișiere până la 500MB** | ✅ |
| Fallback base64 fără R2 (4MB) | ✅ |
| **Extragere text din PDF/DOCX/TXT/CSV/code** | ✅ |
| **Text fișiere reținut ca context în conversație** | ✅ |
| **Fișiere stocate permanent, vizibile în UI** | ✅ |
| **Ștergere fișiere din UI** | ✅ |
| Imagini (vision models) | ✅ |
| **Diagrame Mermaid** (flowchart, sequence, gantt, ER) | ✅ |
| **Grafice Chart.js** (bar, line, pie, radar etc.) | ✅ |
| **Download PPTX** | ✅ |
| **Download Excel XLSX** | ✅ |
| **Download Word DOCX** | ✅ |
| **Download PDF** | ✅ |
| **Download HTML** | ✅ |
| **Download CSV** | ✅ |
| **Download Markdown** | ✅ |
| Zero chei API în browser | ✅ |
| Multi-device via Supabase | ✅ |
| Edit mesaj cu branching (←/→) | ✅ |
| Retry per mesaj | ✅ |
| Căutare conversații | ✅ |
| Export chat complet | ✅ |
| Modele custom OpenAI-compatible | ✅ |
| Dark mode, responsive | ✅ |

---

## 🎨 Tipuri de documente suportate

Scrie natural în prompt — Claude le generează automat:

```
"Creează un grafic cu vânzările lunare"           → Chart.js (download Excel)
"Fă o prezentare de 8 slide-uri despre..."        → PPTX download
"Generează un raport Word despre..."              → DOCX download
"Exportă datele ca CSV"                           → CSV download
"Creează un document HTML pentru..."              → HTML download
"Diagrama arhitecturii sistemului"                → Mermaid vizual
"Analizează acest PDF și creează un rezumat"      → Upload PDF → context AI
"Compară aceste 3 fișiere CSV"                    → Upload multiple → analiză
```

---

## 📂 Tipuri de fișiere acceptate la upload

| Categorie | Extensii |
|-----------|----------|
| Imagini | JPG, PNG, WebP, GIF, AVIF |
| Documente | PDF, DOCX, TXT, MD |
| Date | CSV, JSON, XML, YAML |
| Cod | JS, TS, PY, JAVA, CPP, GO, RS, PHP, SQL |
| Web | HTML, CSS |
| Config | TOML, INI, ENV |

**Dimensiune maximă:** 500MB cu R2, 4MB fără R2.

---

## 💰 Costuri estimate

| Serviciu | Cost lunar |
|----------|-----------|
| AI (4 modele, 150 msg/zi) | ~$15–28 |
| Cloudflare R2 (10GB gratuit) | $0 |
| Supabase (500MB gratuit) | $0 |
| Netlify (125k req/lună gratuit) | $0 |
| **Total** | **~$15–28/lună** |

---

## 🔧 Dev local

```bash
npm install -g netlify-cli
cp .env.example .env   # completează cheile
netlify dev            # http://localhost:8888
```
