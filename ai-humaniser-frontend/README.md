<div align="center">

# AI Humaniser

### LLM-Powered Text Rewriting Platform

<p align="center">
  A full-stack SaaS platform that rewrites AI-generated text to sound natural and human using a multi-pass Gemini pipeline — with user authentication, subscription management, and usage tracking.
</p>

<br/>

<img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs"/>
<img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white"/>
<img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white"/>
<img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white"/>
<img src="https://img.shields.io/badge/Stripe-635BFF?style=for-the-badge&logo=stripe&logoColor=white"/>
<img src="https://img.shields.io/badge/Gemini-8E75B2?style=for-the-badge&logo=google&logoColor=white"/>
<img src="https://img.shields.io/badge/TailwindCSS-06B6D4?style=for-the-badge&logo=tailwindcss"/>

![License](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)
![Status](https://img.shields.io/badge/Status-In%20Development-orange?style=flat-square)

</div>

---

## Overview

AI Humaniser is a SaaS web application that takes AI-generated text and rewrites it to sound natural, fluent, and human. It uses a 3-pass Gemini 2.5 Flash pipeline that progressively refines the output — removing robotic phrasing, improving tone, and preserving the original meaning.

Built with a full SaaS architecture including user authentication, subscription tiers, Stripe billing, and per-user usage tracking.

---

## Key Features

### Text Rewriting Engine

- 3-pass Gemini 2.5 Flash pipeline for progressive humanization
- Preserves original meaning while rewriting tone and phrasing
- Handles long-form content, essays, emails, and articles
- Consistent quality output with ~15–25 second processing time

### SaaS Architecture

- User authentication with login and account management
- Subscription tiers with usage limits per plan
- Stripe payment integration for billing and plan upgrades
- Per-user API usage tracking and monitoring dashboard

### Dashboard

- Input and output side-by-side view
- Rewrite history per user
- Usage stats (words rewritten, requests used, plan status)
- One-click copy for rewritten output

---

## Screenshots

### Dashboard

![Dashboard](assets/dashboard.png)

### Login

![Login](assets/login.png)

---

## System Architecture

```
User Input (Next.js Frontend)
           |
   Node.js / Express Backend
           |
   +---------------------------+
   |  Pass 1 — Gemini          |  -> Remove AI patterns
   |  Pass 2 — Gemini          |  -> Improve tone and flow
   |  Pass 3 — Gemini          |  -> Final natural refinement
   +---------------------------+
           |
   MongoDB Atlas
   (User data, rewrite history, usage tracking)
           |
   Stripe (Subscription billing)
```

---

## Tech Stack

| Category | Technologies                            |
| -------- | --------------------------------------- |
| Frontend | Next.js, React, TypeScript, TailwindCSS |
| Backend  | Node.js, Express                        |
| Database | MongoDB Atlas                           |
| AI Model | Google Gemini 2.5 Flash                 |
| Payments | Stripe                                  |
| Auth     | JWT                                     |
| Tools    | GitHub, VS Code                         |

---

## Getting Started

### Prerequisites

- Node.js 18+
- MongoDB Atlas account
- Google Gemini API key (free at [aistudio.google.com](https://aistudio.google.com))
- Stripe account for billing

### 1. Clone the Repository

```bash
git clone https://github.com/AbiramiMuthiah/ai-humaniser.git
cd ai-humaniser
```

### 2. Backend Setup

```bash
cd ai-humaniser
npm install
```

Create a `.env` file:

```env
GEMINI_API_KEY=your_gemini_api_key
MONGODB_URI=your_mongodb_connection_string
STRIPE_SECRET_KEY=your_stripe_secret_key
JWT_SECRET=your_jwt_secret
```

Run backend:

```bash
node index.js
# Runs on http://localhost:5000
```

### 3. Frontend Setup

```bash
cd ai-humaniser-frontend
npm install
npm run dev
# Runs on http://localhost:3000
```

---

## Project Structure

```
ai-humaniser/
├── ai-humaniser/              # Backend (Node.js/Express)
│   ├── index.js               # Express app, all routes
│   ├── routes/
│   │   ├── auth.js            # Login, register, JWT
│   │   ├── humanise.js        # 3-pass Gemini pipeline
│   │   └── billing.js         # Stripe webhooks and plans
│   ├── models/                # MongoDB schemas
│   └── package.json
├── ai-humaniser-frontend/     # Frontend (Next.js)
│   ├── app/
│   │   └── page.tsx           # Main application
│   ├── public/
│   └── package.json
├── assets/                    # Screenshots
└── README.md
```

---

## Roadmap

- Deployment to Railway (backend) and Vercel (frontend)
- Custom domain via Cloudflare
- Tone selector (formal, casual, academic)
- Browser extension for in-place rewriting
- API access for developers

---

## Author

**Abirami Muthiah**  
Applied AI Engineer | Full-Stack AI Systems | NLP

[![Portfolio](https://img.shields.io/badge/Portfolio-abiramimuthiah--portfolio.vercel.app-blue?style=flat-square)](https://abiramimuthiah-portfolio.vercel.app)
[![GitHub](https://img.shields.io/badge/GitHub-AbiramiMuthiah-181717?style=flat-square&logo=github)](https://github.com/AbiramiMuthiah)

---

## License

Licensed under the [MIT License](LICENSE).
