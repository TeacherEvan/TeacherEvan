# Implementation Plan: GitHub Profile-as-Portfolio with "PickaBoo" Interactive Sprite Loop

**Date:** 2026-08-27  
**Feature Name:** `github-profile-portfolio`  
**Target Output File:** `README.md` (and accompanying asset generator / GitHub Pages interactive companion in `assets/` & `scripts/`)  
**Specification Reference:** [`docs/Profile as portfolio.txt`](file:///home/ewaldt/Documents/VS/GITHUB%20FRONTPAGE/docs/Profile%20as%20portfolio.txt)

---

## 1. Plan Header

### Goal
Create a high-impact, production-grade **"Profile-as-Portfolio"** GitHub profile (`README.md`) designed to serve as a comprehensive personal branding hub. The profile features:
1. **Dynamic "Live" Visual Identity:** An animated, looped "PickaBoo" sprite experience (inspired by Shapekeeper mechanics with cursor-attraction dynamics and colorful 4-second explosion loops rendered for GitHub's markdown environment).
2. **Status Badges & Quick Identifiers:** High-visibility badges for `FULL STACK`, `SEEKING`, `REMOTE`, `MENTORING`, and `ACTIVE`.
3. **Structured Code-Block "About Me":** Formatted TypeScript/JavaScript object (`const ali: Developer = { ... }`) detailing developer philosophy, interests, and current focus.
4. **Live Metrics & Stats Engine:** Real-time GitHub stats cards, language distribution breakdown, contribution streaks, and trophy display.
5. **Tech Stack & Tooling Matrix:** Categorized modern skill badges (Frontend, Backend, DevOps, AI/Tools) using consistent aesthetic palettes.
6. **Featured Projects & Portfolio Highlights:** Rich showcase cards with live demo links, repository links, and tech tags.

### Architecture & Engine Breakdown
Because GitHub profiles are rendered in GitHub's sanitized Markdown environment (which proxies images via GitHub Camo and prohibits inline `<script>` execution for security), the interactive and animated layer uses a **hybrid architecture**:
- **Layer A (In-README Rich Dynamic Media):** High-frame-rate animated SVG / APNG / GIF loops generated via HTML5 Canvas / Node.js renderer scripts to deliver the "PickaBoo" sprite chasing and explosive particle bursting effect within standard Markdown image tags (`<img src="...">`).
- **Layer B (GitHub Actions Automation Pipeline):** Automated daily/weekly cron workflow to keep dynamic stats, activity feeds, and generated SVG badges cached and up to date.
- **Layer C (Interactive GitHub Pages Companion):** A lightweight standalone HTML5 Canvas web application deployed via GitHub Pages allowing visitors to play the full real-time mouse-tracking interactive "PickaBoo" game with audio/haptic visual explosions when clicking through the profile banner.

### Tech Stack
- **Markup & Formatting:** GitHub Flavored Markdown (GFM), HTML5 semantic blocks (`<details>`, `<table>`, `<div>`, `<align>`), SVG (SMIL & CSS animations).
- **Badge & Metric Providers:** Shields.io, GitHub Readme Stats (`anuraghazra/github-readme-stats`), GitHub Readme Streak Stats, Skill Icons (`skillicons.dev`), Devicon.
- **Asset Generation Engine:** Node.js, HTML5 Canvas / Sharp / Gifenc for sprite loop rendering, pure JavaScript 2D physics engine for particle explosion mechanics.
- **CI/CD & Hosting:** GitHub Actions workflow (`.github/workflows/profile-update.yml`), GitHub Pages (`/public` or `/docs`).

### Effort Estimate
- **Milestone 1 (Foundations & Core Layout):** 1.5 hours
- **Milestone 2 (PickaBoo Sprite Animation Engine):** 2.5 hours
- **Milestone 3 (Live Metrics, Badges & Dynamic Feed):** 1.5 hours
- **Milestone 4 (Interactive Companion & Polish):** 1.5 hours
- **Total Effort:** ~7 hours

---

## 2. Milestone Timeline

| Milestone | Deliverable | Scope / Verification Gate | Feature Flag / Isolation |
| :--- | :--- | :--- | :--- |
| **M1: Core Profile Structure** | `README.md` layout, Hero Header, Status Badges, `const ali: Developer` code block, Tech Stacks | Render test on GitHub dark/light mode; check all badge links and contrast ratios | Static template commit |
| **M2: PickaBoo Sprite Animation** | `assets/pickaboo-loop.gif`, `assets/pickaboo-banner.svg`, generator script `scripts/generate-pickaboo.js` | 60fps particle loop, 4s explosion sequence, crisp rendering under 2MB asset limit | Local visual validation + Camo proxy test |
| **M3: Dynamic Stats & Actions** | Real-time GitHub Stats, Streak, Top Languages cards, GitHub Actions auto-updater `.github/workflows/update-readme.yml` | Action runs cleanly in CI; metrics cards load with matching dark theme | CI automated test run |
| **M4: Project Showcase & Interactive Companion** | Featured project cards, GitHub Pages interactive mini-game (`docs/index.html` or `index.html`), social footer | Live URL deployed on GitHub Pages; click-through from README banner works | GitHub Pages deployment |

---

## 3. Data Flow & System Architecture

### GitHub Markdown & Asset Pipeline Data Flow

```
+-------------------------------------------------------------------------------+
|                             GITHUB USER BROWSER                              |
+-------------------------------------------------------------------------------+
         |                                                       |
         | Views Profile README.md                               | Clicks PickaBoo Banner
         v                                                       v
+------------------------------------+             +----------------------------+
|        GitHub Markdown Engine      |             |   GitHub Pages Companion   |
|   - Strips <script> tags           |             |  (Interactive Web App)     |
|   - Parses GFM & HTML components   |             |  - Real-time mouse follow  |
|   - Proxies images through Camo    |             |  - 4s collision timer      |
+------------------------------------+             |  - Canvas particle boom    |
         |                                         +----------------------------+
         +-----------------------------+
         |                             |
         v                             v
+------------------------+    +--------------------------------+
|  Static & Dynamic SVG  |    |  External Stats APIs & SVGs    |
|  - PickaBoo Sprite GIF |    |  - github-readme-stats         |
|  - Status Badges       |    |  - github-readme-streak-stats  |
|  - Skill Icons Matrix  |    |  - Shields.io Status Badges    |
+------------------------+    +--------------------------------+
                                       ^
                                       | Automated updates via Cron
                              +--------------------------------+
                              | GitHub Actions Workflow (CI)   |
                              | - Fetches latest metrics       |
                              | - Updates dynamic timestamps   |
                              +--------------------------------+
```

### PickaBoo Sprite Lifecycle Loop Logic

```
   [ Sprite Spawn / Idle ]
             |
             v
   [ Seeking / Wandering ] <--- (Simulated Cursor Trajectory in GIF / Real Cursor in Web)
             |
   (Distance < Threshold / Contact)
             |
             v
   [ Timer Triggered: 4-Second Countdown ] ---> (Pulsing color shift, jittering sprite)
             |
   (Timer Reaches 0)
             |
             v
   [ EXPLOSION: Multi-Color Radial Particle Burst ]
             |
   (Particles Fade / Decay)
             |
             v
   [ Respawn & Loop Reset ]
```

---

## 4. Text Layout Mockups

### Profile `README.md` Visual Wireframe

```
+---------------------------------------------------------------------------------------+
|  <div align="center">                                                                 |
|    <!-- Hero Banner with PickaBoo Loop -->                                            |
|    ![PickaBoo Interactive Banner](assets/pickaboo-loop.gif)                            |
|                                                                                       |
|    # Hi there, I'm Ali 👋                                                             |
|    ### Full-Stack Software Engineer & Creative Developer                              |
|                                                                                       |
|    [![FULL STACK](badge-link)] [![SEEKING](badge-link)] [![REMOTE](badge-link)]       |
|    [![MENTORING](badge-link)] [![ACTIVE](badge-link)]                                 |
|  </div>                                                                               |
|                                                                                       |
|  ---                                                                                  |
|                                                                                       |
|  ### 👨‍💻 About Me                                                                     |
|  ```typescript                                                                        |
|  const ali: Developer = {                                                             |
|    pronouns: "he/him",                                                                |
|    code: [TypeScript, Python, Rust, Go, SQL],                                         |
|    technologies: {                                                                    |
|      frontend: ["React", "Next.js", "TailwindCSS", "Three.js"],                       |
|      backend: ["Node.js", "FastAPI", "PostgreSQL", "Redis", "GraphQL"],               |
|      cloud: ["Docker", "Kubernetes", "AWS", "GitHub Actions"]                         |
|    },                                                                                 |
|    currentFocus: "Building scalable distributed systems & rich interactive UI",       |
|    seeking: "High-impact Full-Stack / Platform Engineering roles",                    |
|    funFact: "Sprites in the banner will self-destruct if you stare too closely! 💥"   |
|  };                                                                                   |
|  ```                                                                                  |
|                                                                                       |
|  ---                                                                                  |
|                                                                                       |
|  ### 🛠️ Tech Stack & Tooling                                                          |
|  <p align="center">                                                                   |
|    [Icons: React, TypeScript, Next.js, Python, Node.js, Docker, Postgres, AWS, etc.] |
|  </p>                                                                                 |
|                                                                                       |
|  ---                                                                                  |
|                                                                                       |
|  ### 📊 GitHub Activity & Metrics                                                     |
|  <p align="center">                                                                   |
|    +-----------------------------+  +------------------------------+                  |
|    |   GitHub Readme Stats Card  |  |   Top Languages Card         |                  |
|    +-----------------------------+  +------------------------------+                  |
|    +---------------------------------------------------------------+                  |
|    |   GitHub Streak Stats (Current streak, Longest streak)        |                  |
|    +---------------------------------------------------------------+                  |
|  </p>                                                                                 |
|                                                                                       |
|  ---                                                                                  |
|                                                                                       |
|  ### 🚀 Featured Projects                                                             |
|  | Project | Description | Tech Stack | Links |                                       |
|  | :--- | :--- | :--- | :--- |                                                  |
|  | **PickaBoo Engine** | Interactive sprite particle simulation | Canvas / TS | [Demo] [Repo] |
|  | **Portfolio Hub**   | High-performance portfolio platform   | Next.js / AWS| [Demo] [Repo] |
|                                                                                       |
|  ---                                                                                  |
|                                                                                       |
|  <div align="center">                                                                 |
|    📫 Let's Connect: [LinkedIn] • [X/Twitter] • [Website] • [Email]                   |
|  </div>                                                                               |
+---------------------------------------------------------------------------------------+
```

---

## 5. Risk Table

| Risk | Impact | Likelihood | Mitigation Strategy |
| :--- | :--- | :--- | :--- |
| **GitHub Camo Caching** | External SVGs/GIFs might cache aggressively, preventing updates | High | Use version query params `?v=timestamp` and configure GitHub Actions to purge/update URLs cleanly. |
| **GIF/Asset File Size Bloat** | High file size slows down profile loading and exceeds Camo 5MB proxy limit | Medium | Optimize the PickaBoo loop with color palleting, 32-64 colors max, resolution capped at 800x240px, compressed to keep payload < 1.5MB. |
| **No Direct JS in README** | User asked for cursor-following in MD file directly, but Markdown strips `<script>` | High | Deliver a double solution: (1) A seamless looping animation in README showing the sprite following cursor & exploding after 4s; (2) A clickable banner link directing to a full-screen interactive web game on GitHub Pages. |
| **Dark / Light Theme Incompatibility** | Stats cards and transparent badges look unreadable on GitHub light/dark theme switch | Medium | Use theme-adaptive SVG cards (`theme=tokyonight` or `theme=transparent` / `radical`) and adaptive CSS media queries (`prefers-color-scheme: dark`) in SVG assets. |
| **Third-Party API Downtime** | Readme-stats or streak APIs may occasionally rate-limit or fail | Low | Host fallback static badges and provide reliable mirror endpoints with graceful degradation. |

---

## 6. Bite-Sized Implementation Tasks (TDD & Step-by-Step)

### Phase 1: Directory Setup & Static Profile Scaffolding
- [ ] **Task 1.1: Project Directory Structure**
  - **Files:** Create `assets/`, `scripts/`, `public/`, `.github/workflows/`
  - **Verification:** Run `ls -la` to confirm directory hierarchy.
- [ ] **Task 1.2: Base `README.md` Profile File**
  - **Files:** `README.md`
  - **Content:** Header, Status Badges (`FULL STACK`, `SEEKING`, `REMOTE`, `MENTORING`, `ACTIVE`), `const ali: Developer` TypeScript code block, About section, Tech stack icons, Project table, Contact footer.
  - **Verification:** Markdown linter passes, badge URLs render properly with valid Shields.io styling (`flat-square` / `for-the-badge`).

### Phase 2: PickaBoo Sprite Animation Engine & Assets
- [ ] **Task 2.1: Particle & Sprite Math Simulation Script**
  - **Files:** `scripts/generate-pickaboo.js` (or pure Node.js Canvas / SVG generator)
  - **Logic:**
    - Spawn cute pixel/geometric "PickaBoo" sprite.
    - Path generator simulating cursor movement across screen.
    - Proximity detection triggers 4.00s countdown timer state (visualized as glowing/shaking sprite).
    - Explosion generator: 50+ colorful particles with radial velocity, gravity, and alpha decay.
  - **Verification:** Script outputs clean frames or animated GIF.
- [ ] **Task 2.2: Export Optimized Looping Asset**
  - **Files:** `assets/pickaboo-loop.gif` & `assets/pickaboo-banner.svg`
  - **Verification:** File size is `< 1.8MB`, frame rate is smooth (25-30fps), 4-second explosion loop is seamless and colorful.

### Phase 3: Interactive Companion Web App (GitHub Pages)
- [ ] **Task 3.1: Interactive Canvas Mini-Game**
  - **Files:** `public/index.html` (or `index.html`)
  - **Features:** Real mouse tracking on desktop, touch tracking on mobile, sprite swarm wandering and chasing cursor, 4-second self-destruct countdown timer on contact, particle explosion audio/visual effects, restart button.
  - **Verification:** Open locally in browser; test hover, collision, 4s countdown, and explosion.

### Phase 4: Dynamic Metrics, CI Automation & Final Review
- [ ] **Task 4.1: Dynamic GitHub Stats Cards Integration**
  - **Files:** `README.md`
  - **Integration:** Embed GitHub Readme Stats (with custom color palette: Tokyonight/Catppuccin), Top Languages card, Streak Stats.
  - **Verification:** Cards render live metrics for the user handle.
- [ ] **Task 4.2: Automated Profile Refresh Workflow**
  - **Files:** `.github/workflows/profile-update.yml`
  - **Schedule:** Runs daily at midnight UTC to verify links, rebuild assets if needed, and update timestamps.
  - **Verification:** GitHub Actions syntax validation passes.

---

## 7. Zero-Context Engineer Instructions (How to Execute)

1. **Prerequisites:** Node.js 18+ installed.
2. **Execute Asset Generation:**
   ```bash
   node scripts/generate-pickaboo.js
   ```
3. **Verify Profile Markdown:**
   - Open `README.md` in preview or push to a GitHub repository named after your username (e.g., `username/username`).
4. **Deploy Companion App (Optional):**
   - Enable GitHub Pages in repository settings -> Source: Deploy from branch (`main` / `root` or `/docs`).
