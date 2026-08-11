#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const repo = resolve(process.argv[2] || process.cwd())
const rel = 'apps/slides/src/renderer/ai/slides-skill.ts'
const path = resolve(repo, rel)
let text = readFileSync(path, 'utf8')

function replaceOnce(before, after, label) {
  if (text.includes(after)) return
  const first = text.indexOf(before)
  if (first < 0) throw new Error(`Patch marker not found: ${label}`)
  if (text.indexOf(before, first + before.length) >= 0) throw new Error(`Patch marker ambiguous: ${label}`)
  text = text.slice(0, first) + after + text.slice(first + before.length)
}

replaceOnce(
  `## Most important tool-selection principles (judge the scenario before acting)\n`,
  `## Most important tool-selection principles (judge the scenario before acting)\n- **Codex authentication rule**: this build uses ChatGPT/Codex for the AI runtime. Never ask the user to sign in to Genspark, restart GenOffice to refresh a Genspark token, or treat missing Genspark credentials as a user-login problem. generate_deck automatically selects the best available renderer; when it reports Codex-native rendering mode, continue immediately with native Slides tools in the same turn until every requested page is actually on the canvas.\n`,
  'Codex authentication rule',
)

replaceOnce(
  `      if (!access.generatePageCloud || !(await access.isCloudPageGenEnabled?.().catch(() => false)))\n        return fail(\n          t('aiFailGenDeck'),\n          'Cloud slide generation is unavailable — sign in to Genspark (gsk) first',\n        )\n      if (!access.generateFromHtml)\n        return fail(\n          t('aiFailGenDeck'),\n          'The current environment does not support the HTML→pptx pipeline',\n        )`,
  `      const cloudPageGenAvailable =\n        !!access.generatePageCloud &&\n        !!(await access.isCloudPageGenEnabled?.().catch(() => false))\n      // Genspark slide_generate is an optional renderer in the Codex build. Missing gsk\n      // credentials are never an authentication failure: planning/style still run through\n      // the configured AI runtime (Codex), and Step 2 below falls back to native Slides tools.\n      if (cloudPageGenAvailable && !access.generateFromHtml)\n        return fail(\n          t('aiFailGenDeck'),\n          'The cloud renderer is available but the HTML→pptx landing pipeline is unavailable',\n        )`,
  'generate_deck optional cloud gate',
)

replaceOnce(
  `      // ── Step 2: generate page by page + land as we go (frontend shows pages one by one).\n      // The cloud service (gsk slide_generate) writes each page's HTML and converts it to a\n      // one-slide pptx; genOne returns a marker and landing reads the bytes.`,
  `      // ── Step 2: generate page by page + land as we go (frontend shows pages one by one).\n      // In a Codex build the Genspark page renderer is optional. If it is unavailable, hand the\n      // fully planned page briefs back to the same Codex turn and mechanically allow native\n      // Slides construction. This avoids an impossible gsk-login loop while preserving the\n      // existing high-polish cloud path whenever it is actually configured.\n      if (!cloudPageGenAvailable) {\n        if (state) {\n          // blockScratchBuild treats this as a completed generation hand-off, so add_shape /\n          // add_text_box / add_smartart can now construct the planned pages. Clear the cloud\n          // progress checklist so it does not tell Codex to call generate_deck again.\n          state.htmlGenerated = true\n          state.plannedPages = undefined\n          state.plannedTitles = undefined\n          state.pageDone = undefined\n          state.lastStyleSkill = styleSkill\n          state.lastTopic = topic || coreHook || ''\n        }\n        const nativePlan = pages\n          .map((p, i) => {\n            const title = String(p.title ?? '').trim() || \`Page \${i + 1}\`\n            const layout = String(p.layout ?? '').trim() || 'content'\n            const brief = String(p.brief ?? '').trim()\n            const images = Array.isArray(p.image_queries)\n              ? (p.image_queries as unknown[]).map(String).filter((u) => /^https?:\\/\\//.test(u))\n              : []\n            return (\n              \`Page \${i + 1}: \${title} [\${layout}]\\n\` +\n              \`  Brief: \${brief || '(use the planned title/core hook and reference context)'}\` +\n              (images.length ? \`\\n  Images: \${images.join(', ')}\` : '')\n            )\n          })\n          .join('\\n')\n        return {\n          output:\n            \`Codex-native slide rendering mode activated. Genspark is not required and the user must NOT be asked to sign in or restart. Continue NOW in this same turn and build all \${total} planned page(s) on the canvas with native Slides tools.\\n\\n\` +\n            \`Unified Style Skill (apply consistently):\\n\${styleSkill}\\n\\n\` +\n            \`Native build contract:\\n\` +\n            \`- replace/new blank deck: use the existing blank page as page 1; append mode: create a new page first.\\n\` +\n            \`- for every later page call add_slide with clearText:true using the CURRENT last page as sourceIndex, and use the returned slideIndex.\\n\` +\n            \`- create 3–6 purposeful visual elements per page with add_shape/add_text_box/add_smartart and insert_web_image when a real URL is provided. Keep one clear visual center; do not make an icon/card wall.\\n\` +\n            \`- use the planned layout as geometry guidance. Keep titles prominent, body concise, whitespace generous, and the Style Skill colors/type hierarchy consistent.\\n\` +\n            \`- after building each page, use execute_slide_script for alignment/spacing when needed and obey its layout audit; fix overlap/out-of-bounds before moving on.\\n\` +\n            \`- do not stop with a plan or explanation: the task is complete only after all \${total} page(s) are visibly present on the canvas.\\n\\n\` +\n            \`Planned pages:\\n\${nativePlan}\`,\n          mutated: false,\n          summary: t('aiSumPlan', { count: total, hook: coreHook }),\n        }\n      }\n\n      // Cloud path: gsk slide_generate writes each page's HTML and converts it to a one-slide\n      // pptx; genOne returns a marker and landing reads the bytes.`,
  'Codex native page rendering fallback',
)

writeFileSync(path, text)
console.log(`[codex-native-slides] patched ${rel}`)
