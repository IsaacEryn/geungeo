// ④ 코드 검증(설계 2-4). 모델이 낸 인용을 캐시·검색 결과와 대조해 지어낸 근거를 버린다.
import type { ArticleCandidate, ChangeSignal, Citation, DraftAnswer, Verdict, VerificationIssue, WebResult } from "./types";
import { dice, extractClaimNumbers, findNormalized, formatKoreanDate, mentionsDate, normalizeForMatch } from "./text";

export interface VerifyInput {
  draft: DraftAnswer;
  candidates: ArticleCandidate[];
  web: WebResult[];
  signals: ChangeSignal[];
  asOf: string;
}

export interface VerifyOutcome {
  draft: DraftAnswer;
  issues: VerificationIssue[];
  removed_citations: number;
  verdict_before: Verdict;
  verdict_after: Verdict;
  warnings: string[];
  /** 위반이 커서 ③을 한 번 더 부를 만한지 */
  needs_retry: boolean;
  /** 재시도 때 모델에 줄 설명 */
  feedback: string;
}

/** 근거 없음을 코드가 정했을 때의 결론 문구 */
export const NO_BASIS_SUMMARY =
  "기준일 현재 찾아본 법령·학칙과 검색 결과에서 질문에 직접 답하는 근거를 확인하지 못했습니다. 아래 '찾아본 범위'와 확인할 곳을 참고해 주세요.";

const MIN_FUZZY = 0.6;

/** 원문을 문장·줄 단위로 나눈다(인용문 자동 교정 후보) */
function segments(text: string): string[] {
  return text
    .split(/\n|(?<=다\.)\s+|(?<=\.)\s+(?=[①-⑮])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

type QuoteCheck = { status: "exact"; quote: string } | { status: "corrected"; quote: string } | { status: "missing" };

/** 인용문이 원문에 있는지(정규화 뒤 부분 일치), 없으면 가장 비슷한 문장으로 교정 */
export function checkQuote(source: string, quote: string): QuoteCheck {
  const q = quote.trim();
  if (!q) return { status: "missing" };
  const range = findNormalized(source, q);
  if (range) return { status: "exact", quote: source.slice(range[0], range[1]) };
  // "…"로 이어 붙인 인용: 조각이 모두 원문에 있으면 가장 긴 조각만 남긴다
  const parts = q.split(/…|\.{3}/).map((p) => p.trim()).filter((p) => normalizeForMatch(p).text.length >= 6);
  if (parts.length > 1) {
    const ranges = parts.map((p) => findNormalized(source, p));
    if (ranges.every(Boolean)) {
      const longest = ranges.reduce((a, b) => (b![1] - b![0] > a![1] - a![0] ? b : a))!;
      return { status: "corrected", quote: source.slice(longest[0], longest[1]) };
    }
  }
  let best = { score: 0, text: "" };
  for (const seg of segments(source)) {
    const s = dice(seg, q);
    if (s > best.score) best = { score: s, text: seg };
  }
  if (best.score >= MIN_FUZZY) return { status: "corrected", quote: best.text };
  return { status: "missing" };
}

function webSourceText(w: WebResult): string {
  return `${w.title}\n${w.description}`;
}

export function verifyDraft(input: VerifyInput): VerifyOutcome {
  const { draft, asOf } = input;
  const candidates = new Map(input.candidates.map((c) => [c.id, c]));
  const web = new Map(input.web.filter((w) => !w.excluded).map((w) => [w.id, w]));
  const proposals = new Set(input.signals.filter((s) => s.kind === "legislative_notice").map((s) => s.web_id));
  const issues: VerificationIssue[] = [];
  const warnings: string[] = [];
  const caveats = [...draft.caveats];
  let removed = 0;

  const kept: Citation[] = [];
  const seen = new Set<string>();
  for (const citation of draft.citations) {
    const cand = candidates.get(citation.id);
    const w = cand ? undefined : web.get(citation.id);
    if (!cand && !w) {
      issues.push({ kind: "unknown_id", citation_id: citation.id, detail: "후보 조문·검색 결과에 없는 ID라 뺐습니다." });
      removed += 1;
      continue;
    }
    const source = cand ? cand.text : webSourceText(w!);
    const check = checkQuote(source, citation.quote);
    if (check.status === "missing") {
      issues.push({ kind: "quote_not_found", citation_id: citation.id, detail: "인용문을 원문에서 찾지 못해 뺐습니다." });
      removed += 1;
      continue;
    }
    if (check.status === "corrected") {
      issues.push({ kind: "quote_corrected", citation_id: citation.id, detail: "인용문을 원문 해당 부분으로 바꿨습니다." });
    }
    let role = citation.role;
    // W3(언론·블로그)와 입법예고는 근거가 될 수 없다 → 참고로 낮춘다
    if (w && (w.grade === "W3" || proposals.has(w.id)) && role !== "reference") role = "reference";
    const key = `${citation.id}|${check.quote}`;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ id: citation.id, quote: check.quote, role });
  }

  const verdictBefore = draft.verdict;
  let verdict = draft.verdict;
  let summary = draft.summary;

  // 3. 시행 예정 조문을 현행처럼 말했는지: 결론에 시행일이 없으면 partial로 낮추고 시행일 문구를 붙인다
  const notYetCited = new Map<string, ArticleCandidate>();
  for (const c of kept) {
    const cand = candidates.get(c.id);
    if (cand && cand.status === "not_yet" && c.role !== "reference") notYetCited.set(cand.id, cand);
  }
  for (const cand of notYetCited.values()) {
    if (!mentionsDate(summary, cand.effective_from)) {
      issues.push({
        kind: "not_yet_as_current",
        citation_id: cand.id,
        detail: `${cand.law_name} ${cand.number}은 ${formatKoreanDate(cand.effective_from)} 시행 예정인데 결론에 시행일이 없습니다.`,
      });
      if (verdict === "answered") verdict = "partial";
      caveats.push(
        `${cand.law_name} ${cand.number}은 ${formatKoreanDate(cand.effective_from)}부터 시행합니다. 기준일(${formatKoreanDate(asOf)}) 현재는 적용되지 않습니다.`,
      );
    }
  }

  // 5. 남은 근거가 0개면 근거 없음
  const basisCount = kept.filter((c) => {
    if (c.role === "reference") return false;
    const w = web.get(c.id);
    return !(w && w.grade === "W3");
  }).length;
  let forcedNoBasis = false;
  if (basisCount === 0 && verdict !== "no_basis") {
    issues.push({ kind: "no_citations_left", detail: "검증을 통과한 근거가 없어 '근거 없음'으로 바꿨습니다." });
    verdict = "no_basis";
    forcedNoBasis = true;
    summary = NO_BASIS_SUMMARY;
  }

  // 4. 결론의 숫자가 인용 원문에 있는지
  if (!forcedNoBasis) {
    const strong: string[] = [];
    const weak: string[] = [];
    for (const c of kept) {
      const cand = candidates.get(c.id);
      if (cand) strong.push(cand.text);
      const w = web.get(c.id);
      if (w) (w.grade === "W3" ? weak : strong).push(webSourceText(w));
    }
    for (const w of web.values()) if (w.grade === "W3") weak.push(webSourceText(w));
    const strongFlat = strong.join(" ").replace(/\s+/g, "");
    const weakFlat = weak.join(" ").replace(/\s+/g, "");
    for (const num of extractClaimNumbers(summary)) {
      if (strongFlat.includes(num)) continue;
      if (weakFlat.includes(num)) {
        issues.push({ kind: "w3_number", detail: `'${num}'는 언론·블로그 자료에만 있는 수치입니다.` });
        warnings.push(`결론의 '${num}'는 언론 보도 등에만 있는 수치입니다. 원문 확인이 필요합니다.`);
      } else {
        issues.push({ kind: "number_unsupported", detail: `'${num}'를 인용한 원문에서 찾지 못했습니다.` });
        warnings.push(`결론의 '${num}'를 인용한 원문에서 찾지 못했습니다. 원문을 확인해 주세요.`);
      }
    }
  }

  const checklist = draft.checklist.map((item) => ({
    ...item,
    basis_ids: item.basis_ids.filter((id) => kept.some((c) => c.id === id)),
  }));

  const needsRetry = (forcedNoBasis && removed > 0) || removed >= 2;
  const feedback = issues
    .filter((i) => i.kind === "unknown_id" || i.kind === "quote_not_found" || i.kind === "not_yet_as_current")
    .map((i) => `- ${i.citation_id ?? ""}: ${i.detail}`)
    .join("\n");

  return {
    draft: {
      verdict,
      summary,
      citations: kept,
      checklist: verdict === "no_basis" ? [] : checklist,
      caveats: [...new Set(caveats)],
      searched_scope: verdict === "no_basis" ? draft.searched_scope : null,
    },
    issues,
    removed_citations: removed,
    verdict_before: verdictBefore,
    verdict_after: verdict,
    warnings,
    needs_retry: needsRetry,
    feedback: feedback
      ? `${feedback}\n후보 목록의 ID와 원문 그대로의 인용만 쓰세요. 시행 예정 조문은 시행일을 결론에 쓰세요.`
      : "",
  };
}
