<div align="center">

# AI Humaniser

### Full-Stack AI Platform for Human-Like Text Transformation & AI Detection Bypass

<p align="center">
  Transform AI-generated text into natural, engaging, human-written content using a multi-pass Gemini AI rewriting pipeline combined with a rule-based NLP post-processing engine — designed to score 0% on AI detectors like Quillbot, GPTZero, Turnitin, and ZeroGPT.
</p>

<br/>

<img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white"/>
<img src="https://img.shields.io/badge/React_19-61DAFB?style=for-the-badge&logo=react&logoColor=black"/>
<img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white"/>
<img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white"/>
<img src="https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white"/>
<img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white"/>
<img src="https://img.shields.io/badge/Google_Gemini-4285F4?style=for-the-badge&logo=google&logoColor=white"/>
<img src="https://img.shields.io/badge/Stripe-635BFF?style=for-the-badge&logo=stripe&logoColor=white"/>
<img src="https://img.shields.io/badge/TailwindCSS-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white"/>

</div>

---

## Overview

AI Humaniser is a production-ready SaaS platform that rewrites AI-generated text so it reads like it was written by a real person. It combines a multi-pass Google Gemini rewriting pipeline with a deterministic rule-based post-processing engine targeting the exact patterns that AI detectors flag.

The platform includes user authentication, a subscription billing system with Stripe (MYR pricing), per-plan daily usage limits, file upload support (PDF, DOCX, TXT), history tracking, and a responsive dashboard — all built as a full-stack Next.js + Node.js application.

---

## Live Features

### AI Humanisation Engine

- **Multi-pass rewriting** — Pass 1 destroys AI sentence structure; Pass 2 (Pro/Unlimited) hunts remaining AI-sounding sentences
- **4 writing modes** — Standard, Academic, Creative, Casual
- **Rule-based post-processor** — 60+ word swaps, contraction enforcement, em-dash injection, passive voice removal, paragraph opener variation
- **Targets 0% AI detection** on Quillbot, GPTZero, Turnitin, ZeroGPT

### Subscription & Billing

- **Stripe Checkout** with MYR pricing — Basic (RM9), Pro (RM19), Unlimited (RM39)
- Monthly and yearly billing toggle
- Webhook-based plan upgrades + session-based confirmation fallback (works on localhost)
- Auto plan downgrade on subscription cancellation

### User Dashboard

- Word count live counter with per-plan limits
- Inline copy button with visual feedback
- Collapsible history sidebar with 3-dot context menu
- Load previous outputs back into the editor
- File upload (Pro & Unlimited) — PDF, DOCX, TXT up to 5MB

### Authentication

- Email/password registration and login with JWT
- Google OAuth via `@react-oauth/google`
- 30-day token expiry with auto-logout on 401

---

## AI Detection Bypass — How It Works

The humaniser runs text through 3 layers:

**Layer 1 — Gemini rewrite (all plans)**
The prompt explicitly instructs the model to destroy every pattern AI detectors flag: uniform sentence length, perfect paragraph structure, formal transitions, passive voice, and predictable topic→evidence→conclusion flow.

**Layer 2 — Gemini vocabulary pass (Pro & Unlimited only)**
A second pass reads the output and rewrites only sentences that still sound AI-written, leaving already-human parts untouched.

**Layer 3 — Rule-based post-processing (all plans)**
Deterministic transformations that AI prompts alone can't guarantee:

- 60+ specific word replacements (furthermore → on top of that, utilize → use, individuals → people, etc.)
- Sentence breaking at natural "and/but/which" junctions
- Em-dash injection for human emphasis
- Contraction enforcement at ~60% rate for natural feel
- Passive voice pattern removal
- Paragraph opener variation

---

## Tech Stack

| Layer          | Technology                                        |
| -------------- | ------------------------------------------------- |
| Frontend       | Next.js 16, React 19, TypeScript, Tailwind CSS    |
| HTTP client    | Axios with JWT interceptors and auto-logout       |
| Backend        | Node.js 22, Express.js                            |
| AI engine      | Google Gemini 2.0 Flash (`@google/generative-ai`) |
| Database       | MongoDB Atlas, Mongoose ODM                       |
| Authentication | JWT (jsonwebtoken), bcryptjs, Google OAuth        |
| Payments       | Stripe Checkout, Subscriptions, Webhooks          |
| File parsing   | Multer, pdf-parse, mammoth                        |
| Dev tools      | nodemon, dotenv                                   |

---

## Project Architecture

```
ai-humaniser/                        ← backend root
├── server/
│   ├── server.js                    ← Express app, all API routes
│   └── middleware/
│       ├── authMiddleware.js        ← JWT verification
│       └── usageLimit.js           ← daily limit enforcement
├── models/
│   ├── User.js                     ← plan, dailyCount, bcrypt hooks
│   └── Text.js                     ← history with mode field
├── routes/
│   └── auth.js                     ← /register, /login, /google
├── config/
│   └── db.js                       ← MongoDB connection
└── package.json

ai-humaniser-frontend/               ← frontend root
├── app/
│   ├── dashboard/page.js           ← main editor + history sidebar
│   ├── pricing/page.js             ← Stripe checkout with MYR plans
│   ├── login/page.js
│   ├── register/page.js
│   ├── texts/[id]/page.js          ← history item view
│   └── components/
│       ├── GoogleButton.js
│       └── LogoMark.jsx
├── lib/
│   └── api.js                      ← Axios instance
└── package.json
```

---

## API Endpoints

| Method | Path                       | Auth       | Description                          |
| ------ | -------------------------- | ---------- | ------------------------------------ |
| POST   | `/auth/register`           | —          | Create account                       |
| POST   | `/auth/login`              | —          | Login, returns JWT                   |
| POST   | `/auth/google`             | —          | Google OAuth login/register          |
| GET    | `/me`                      | ✓          | Current user + usage stats           |
| POST   | `/humanise`                | ✓          | Rewrite text (enforces plan limits)  |
| GET    | `/history`                 | ✓          | List all history items               |
| GET    | `/texts/:id`               | ✓          | Single history item                  |
| DELETE | `/texts/:id`               | ✓          | Delete history item                  |
| POST   | `/upload-file`             | ✓          | Parse PDF/DOCX/TXT (Pro & Unlimited) |
| POST   | `/create-checkout-session` | ✓          | Create Stripe checkout               |
| POST   | `/confirm-payment`         | ✓          | Confirm plan upgrade from session ID |
| POST   | `/webhook`                 | Stripe sig | Handle subscription events           |

---

## Plan Limits

| Plan      | Price   | Daily Limit | Words/Request | File Upload |
| --------- | ------- | ----------- | ------------- | ----------- |
| Free      | RM0     | 5/day       | 300           | ✕           |
| Basic     | RM9/mo  | 25/day      | 500           | ✕           |
| Pro       | RM19/mo | 100/day     | 1,500         | ✓           |
| Unlimited | RM39/mo | 300/day     | Unlimited     | ✓           |

---

## Screenshots

### Dashboard

![Dashboard](assets/dashboard.png)

### Login Page

![Login](assets/login.png)

---

## Installation

### Prerequisites

- Node.js 18+
- MongoDB Atlas account
- Google Gemini API key — [aistudio.google.com](https://aistudio.google.com/app/apikey)
- Stripe account

### Backend Setup

```bash
git clone https://github.com/AbiramiMuthiah/ai-humaniser.git
cd ai-humaniser

npm install
```

Create a `.env` file in the `ai-humaniser/` folder:

```env
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/ai-humaniser
JWT_SECRET=your_long_random_secret
GEMINI_API_KEY=your_gemini_api_key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_BASIC_PRICE_ID=price_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_UNLIMITED_PRICE_ID=price_...
FRONTEND_URL=http://localhost:3000
PORT=5000
```

```bash
npm run dev
# Server runs on http://localhost:5000
```

### Frontend Setup

```bash
cd ai-humaniser-frontend
npm install
```

Create `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:5000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
```

```bash
npm run dev
# Frontend runs on http://localhost:3000
```

### Stripe Webhooks (local testing)

```bash
stripe listen --forward-to localhost:5000/webhook
```

---

## Deployment

| Service  | Platform          |
| -------- | ----------------- |
| Frontend | Vercel            |
| Backend  | Railway or Render |
| Database | MongoDB Atlas     |

Set all environment variables in your deployment platform's dashboard. Update `FRONTEND_URL` to your production domain before deploying.

---

## Future Improvements

- Fine-tuned local model for offline humanisation
- AI detection score display (integrated detector API)
- Multi-language support
- Batch file processing
- Real-time collaborative editing
- Writing style profiles (save custom tones)
- Analytics dashboard (usage, detection scores over time)
- Chrome extension for in-browser humanisation

---

## Author

### Abirami Muthiah

Full-Stack AI Developer | Applied AI & NLP Systems

**Specializations**

- Full-Stack Web Development (Next.js, Node.js)
- AI Integration & Prompt Engineering
- Natural Language Processing
- SaaS Product Development
- Payment Systems Integration

**GitHub:** [github.com/AbiramiMuthiah](https://github.com/AbiramiMuthiah)

---

## License

Licensed under the MIT License.
