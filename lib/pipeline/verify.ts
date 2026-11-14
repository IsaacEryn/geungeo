// ④ 코드 검증(설계 2-4). 모델이 낸 인용을 캐시·검색 결과와 대조해 지어낸 근거를 버린다.
import type { ArticleCandidate, ChangeSignal, Citation, DraftAnswer, Scene, Verdict, VerificationIssue, VerificationIssueKind, WebResult } from "./types";
import { mentionsAnyConcept } from "./concepts";
import { dice, extractClaimNumbers, findNormalized, formatKoreanDate, mentionsDate, normalizeForMatch } from "./text";

export interface VerifyInput {
  draft: DraftAnswer;
  candidates: ArticleCandidate[];
  web: WebResult[];
  signals: ChangeSignal[];
  asOf: string;
  /** 질문(숫자를 묻는 질문인지 볼 때). 없으면 '위임만 있음 → 근거 없음' 규칙을 건너뛴다 */
  question?: string;
  /** 공고 위임 문구가 있는 후보 조 ID("교육부장관이 정하여 공고") */
  noticeDelegated?: string[];
  /** ① 장면. 업무 시작(initiating)일 때만 근거 조문과 개념어를 대조한다 */
  scene?: Scene;
  /** 질문의 드문 개념어 묶음(개념어마다 동의어 포함, concepts.ts rareConceptTerms). 비면 대조하지 않는다 */
  conceptTerms?: string[][];
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
  /** ③을 다시 부를 만하다고 본 이유(issue 종류). needs_retry가 거짓이면 빈 배열 */
  retry_reasons: VerificationIssueKind[];
}

/** 숫자·기간·한도를 묻는 질문 */
const QUANTITY_QUESTION = /몇|며칠|얼마|최대|최소|상한|하한|한도|기간/;
/** 학칙에 맡기는 문구 */
const SCHOOL_RULE_PHRASE = /학칙(?:으로|이|에서|에)\s*(?:정하|정한|정해|따라|위임)/;
/**
 * 근거인지 아닌지 판단을 미룬 표현("근거로 제시할 수 있다", "근거로 삼을 수 있다", "근거로 볼 여지가 있다", "근거가 될 수 있다").
 * "제4조를 근거로 감면을 신청할 수 있다"처럼 근거로 [업무 행위]를 할 수 있다는 말은 정상 답이므로 잡지 않는다
 */
const DEFERRED_BASIS =
  /근거(?:로\s*(?:(?:제시|원용|인용|해석|이해)(?:할|될|하는|되는)?|삼을|들|볼)|가\s*될)\s*(?:수[도는]?\s*있|여지)/;
/** 인용한 조문이 질문 주제를 "직접 정한 조항은 아니다", "직접 근거는 아니다"라고 밝힌 표현 */
const DISCLAIMED_BASIS =
  /(?:자체|직접)[가-힣·\s]{0,10}?(?:명시|정하|정한|정함|규정|규율)[가-힣]{0,3}\s*(?:규정|조항|조문|근거|것)[이가은는]?\s*아(?:니|닙)|직접(?:적인|적)?\s*근거[가는]?\s*아(?:니|닙)/;
/** "근거로" 뒤에서 그 조문을 근거로 쓰지 말라고 하는 말("근거로 삼을 수 없다", "근거로 쓰면 안 된다") */
const NEGATED_BASIS = /수\s*없|안\s*(?:됩|된|되|돼)|않|못|아니/;
/**
 * 부정 문구 앞에 새로 온 다른 자료 주어("시행령의 관련 조항은", "교육부 공고는", "언론 보도도").
 * "이 조항은"·"해당 규정은"처럼 앞 조문을 가리키는 말은 따로 거른다
 */
const SOURCE_NOUN =
  "시행령|시행규칙|법률|법령|(?<!방)법|규정|규칙|조항|조문|지침|공고|보도자료|보도|기사|학칙|훈령|고시|예규|세칙|내규|정관|조례|자료|공문|안내문?|편람|매뉴얼|가이드라인|해석|판례|회신";
/** 자료 이름 + 은/는/도. "상위 법령 자체는 … 직접 정한"처럼 "자체"가 부정 문구에 들지 못한 꼴도 본다 */
const OTHER_SOURCE_SUBJECT = new RegExp(`([가-힣·]*(?:${SOURCE_NOUN}))\\s*(?:자체\\s*)?(?:은|는|도)(?=\\s|$)`, "g");
/** 부정 문구가 "자체"로 시작할 때("시행령 자체는 …") 그 바로 앞에 붙은 자료 이름 */
const SOURCE_BEFORE_ITSELF = new RegExp(`([가-힣·]*(?:${SOURCE_NOUN}))\\s*$`);
/** 어느 자료든 가리킬 수 있는 일반 명사(근거로 든 이름과 겹치는지 따지지 않는다) */
const GENERIC_SOURCE = new Set(["조항", "조문", "규정", "규칙", "자료", "법"]);
/** 앞에서 말한 조문·자료를 가리키는 지시어("이", "해당", "본", "동", "상기", "당해") */
const DEMONSTRATIVE = "이|그|해당|위|같은|앞의|본|동|상기|당해";
/** 그 주어가 앞 조문을 가리키는 지시어로 시작하는지("이 조항", "같은 규정", "본 규정") */
const DEMONSTRATIVE_TAIL = new RegExp(`(?:^|[\\s,])(?:${DEMONSTRATIVE})\\s*$`);
/** 지시어를 붙여 쓴 주어("이규정", "해당규정", "동규정") */
const DEMONSTRATIVE_JOINED = new RegExp(`^(?:${DEMONSTRATIVE})(?:조항|조문|규정|규칙|법)$`);
/**
 * 꾸미는 말 없이 일반 명사 하나만 주어로 왔는지 보려고, 주어 바로 앞이 쉼표나 앞 절을 잇는 어미("지급하며",
 * "처리하되", "확인했으나")로 끝나는지 본다
 */
const CLAUSE_END = /(?:,|며|되|지만|는데|은데|므로|면서|(?:하|되|이|있|없|었|았|였|했|겠)(?:고|나|서))$/;
/** 조 번호 */
const ARTICLE_NUMBER = /제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/g;
/** 앞에서 말한 조문을 가리키는 말("이 조항", "해당 규정", "같은 조") */
const DEMONSTRATIVE_ARTICLE = new RegExp(
  `^(?:다만|그러나|하지만|단|또한|그런데)?[,\\s]*(?:${DEMONSTRATIVE})\\s*(?:조항|조문|규정|조)(?=[은는이가도의\\s,]|에)`,
);
/**
 * 조 번호 없이 조문을 가리키는 말("적용 범위의 단서에 따라", "신설 조항에 따라").
 * "단서"는 '실마리' 뜻("판단할 단서가 없다")을 빼려고 단서 조항을 가리키는 꼴만 본다
 */
const UNNUMBERED_REFERENCE =
  /단서(?=\s*(?:조항|규정|에\s*따라|에\s*따르면|에\s*의하면|에\s*의해|에서|상))|조항(?=\s*(?:에\s*따라|에\s*따르면|에\s*의하면|에\s*의해|상))/g;
/** 그 말 바로 앞(같은 문장, 25자 안)에 조·항·호 번호가 있으면 번호를 쓴 것으로 본다 */
const NUMBER_NEARBY = /제\s*\d+\s*(?:조(?:의\s*\d+)?|항|호)|같은\s*조/;
/** "이 조항에 따라", "그 단서에 따라"처럼 앞 조문을 가리키는 말 */
const DEMONSTRATIVE_BEFORE = new RegExp(`(?:^|\\s)(?:${DEMONSTRATIVE})\\s*$`);
const NEARBY_CHARS = 25;
/** 개정 판 시행일을 알릴 만큼 최근인지(기준일 기준) */
const RECENT_AMENDMENT_YEARS = 3;
const MAX_AMENDMENT_NOTES = 2;

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

/** 결론을 문장으로 나눈다 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** 조 번호를 "12-2"처럼 맞춰 볼 수 있는 꼴로 */
function articleKeys(text: string): string[] {
  return [...text.matchAll(ARTICLE_NUMBER)].map((m) => (m[2] ? `${m[1]}-${m[2]}` : m[1]));
}

/** 근거로 든 이름의 낱말이 그 낱말로 시작하는지("장학"은 "장학금 지급 규정"의 "장학금"을 줄인 말) */
function sharesCoreWord(basis: string, token: string): boolean {
  if (token.length < 2 || !/^[가-힣·]+$/.test(token)) return false;
  return basis.split(/\s+/).some((w) => w.startsWith(token));
}

/**
 * "근거로" 뒤, 부정 문구 앞에 다른 자료를 가리키는 주어가 새로 왔는지.
 * "…를 근거로 인정하며, 시행령의 관련 조항은 직접 근거는 아닙니다"는 근거로 든 조문이 아니라 다른 자료를 부정한 것이다.
 * 다음은 다른 자료로 보지 않는다: "이 조항은"·"본 규정은"·"이규정은"처럼 앞 조문을 가리킨 주어, 꾸미는 말 없이
 * 일반 명사 하나만 온 주어("지급하며, 규정은"), "근거로" 앞에서 이미 든 이름("학칙 제7조를 근거로 … 학칙은")과
 * 그 이름을 줄여 쓴 주어("장학금 지급 규정 제5조를 근거로 … 장학 규정은")
 */
function namesOtherSource(basis: string, head: string, disclaim: string): boolean {
  const found = [...head.matchAll(OTHER_SOURCE_SUBJECT)].map((m) => ({ at: m.index, word: m[1] }));
  if (disclaim.startsWith("자체")) {
    const m = SOURCE_BEFORE_ITSELF.exec(head);
    if (m) found.push({ at: m.index, word: m[1] });
  }
  return found.some(({ at, word }) => {
    const before = head.slice(0, at);
    if (DEMONSTRATIVE_TAIL.test(before) || DEMONSTRATIVE_JOINED.test(word)) return false;
    const prev = before.trim().split(/\s+/).filter(Boolean).at(-1) ?? "";
    if (GENERIC_SOURCE.has(word) && (prev === "" || prev === "근거로" || CLAUSE_END.test(prev))) {
      // "법은"만 따로 오면 근거로 든 학칙이 아니라 상위 법을 말할 수 있다
      if (word !== "법" || basis.includes("법")) return false;
    }
    // 근거로 든 이름의 낱말을 줄여 쓰고 같은 종류 명사를 붙인 주어("장학 규정은")
    if (basis.includes(word) && sharesCoreWord(basis, prev)) return false;
    // "기숙사 운영 규정은"처럼 근거로 든 이름을 다시 쓰면 같은 자료다(일반 명사 한 낱말만으로는 판단하지 않는다)
    const words = [...before.trim().split(/\s+/).filter(Boolean).slice(-2), word];
    for (let k = 1; k <= words.length; k += 1) {
      const name = words.slice(-k).join(" ");
      if (k === 1 && GENERIC_SOURCE.has(word)) continue;
      if (basis.includes(name)) return false;
    }
    return true;
  });
}

/**
 * "근거로"로 든 조문을 같은 결론에서 "직접 정한 조항은 아니다"라고 스스로 부정했는지.
 * 부정은 같은 문장의 "근거로" 뒤, 또는 바로 다음 문장이 "이 조항은"·"해당 규정은"처럼 그 조문을 가리키거나 같은 조 번호를 들 때만 본다.
 * 다른 참고 조문을 "직접 근거는 아니다"라고 밝힌 것은 정상 답이다. 같은 문장이라도 부정 문구 앞에
 * 다른 자료 주어("시행령은", "교육부 공고는")가 새로 오면 그 자료를 부정한 것으로 본다
 */
function disclaimsOwnBasis(summary: string): boolean {
  const list = sentences(summary);
  for (let i = 0; i < list.length; i += 1) {
    const sentence = list[i];
    const at = sentence.indexOf("근거로");
    if (at < 0) continue;
    const after = sentence.slice(at);
    const disclaim = DISCLAIMED_BASIS.exec(after);
    // "근거로 삼을 수 없다", "근거로 쓰면 안 된다"는 근거로 든 것이 아니다(부정 표현이 부정 문구보다 앞에 올 때)
    const negated = NEGATED_BASIS.exec(after);
    if (negated && (!disclaim || negated.index < disclaim.index)) continue;
    const own = articleKeys(sentence.slice(0, at)).at(-1);
    if (disclaim) {
      const head = after.slice(0, disclaim.index);
      const between = articleKeys(head);
      if (between.every((k) => k === own) && !namesOtherSource(sentence.slice(0, at), head, disclaim[0])) return true;
    }
    const next = list[i + 1];
    if (!next) continue;
    const nextDisclaim = DISCLAIMED_BASIS.exec(next);
    if (!nextDisclaim) continue;
    const head = next.slice(0, nextDisclaim.index);
    const named = articleKeys(head);
    if (named.length === 0 && DEMONSTRATIVE_ARTICLE.test(head)) return true;
    if (own && named.length > 0 && named.every((k) => k === own)) return true;
  }
  return false;
}

/**
 * 결론이 조문을 에둘러 근거로 삼았는지. 근거 여부 판단을 미룬 말("근거로 제시할 수 있다")을 썼거나,
 * "근거로" 든 바로 그 조문을 직접 정한 조항이 아니라고 스스로 밝히면 참
 */
export function isHedgedBasis(summary: string): boolean {
  return DEFERRED_BASIS.test(summary) || disclaimsOwnBasis(summary);
}

/** 결론에 조 번호 없이 조문을 가리키는 말이 있는지 */
export function hasUnnumberedReference(summary: string): boolean {
  for (const m of summary.matchAll(UNNUMBERED_REFERENCE)) {
    const before = summary.slice(Math.max(0, m.index - NEARBY_CHARS), m.index).split(/[.。]\s/).at(-1) ?? "";
    if (NUMBER_NEARBY.test(before)) continue;
    // "이 조항에 따라"처럼 앞에서 번호를 든 조문을 다시 가리키면 번호를 쓴 것으로 본다
    if (DEMONSTRATIVE_BEFORE.test(before) && NUMBER_NEARBY.test(summary.slice(0, m.index))) continue;
    return true;
  }
  return false;
}

/** 결론에 그 조 번호("제11조의2")가 나오는지. "제11조"는 "제11조의2"와 구분한다 */
export function mentionsArticle(summary: string, number: string): boolean {
  const m = number.match(/^제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
  if (!m) return true;
  const pattern = m[2] ? `제\\s*${m[1]}\\s*조\\s*의\\s*${m[2]}(?!\\d)` : `제\\s*${m[1]}\\s*조(?!\\s*의\\s*\\d)`;
  return new RegExp(pattern).test(summary);
}

/**
 * 결론이 조 번호 없이 조문을 가리키는데("…의 단서에 따라") 근거로 인용한 조 중 결론에 번호가 없는 조.
 * 어느 조를 말하는지 결론만으로는 알 수 없으므로 ③에 번호를 붙여 다시 쓰게 한다
 */
export function unnamedBasisArticles<T extends Pick<ArticleCandidate, "number">>(summary: string, basis: T[]): T[] {
  if (!hasUnnumberedReference(summary)) return [];
  return basis.filter((c) => !mentionsArticle(summary, c.number));
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
    // 모델이 처음부터 참고로만 인용했으면(지운 인용 없음) 그 결론은 살린다. 지운 인용 때문에 비었으면 정해진 문구로
    if (removed > 0 || kept.length === 0) {
      forcedNoBasis = true;
      summary = NO_BASIS_SUMMARY;
    }
  }

  // 6. 법령이 학칙에 맡기기만 하고 질문이 묻는 숫자·기간이 없으면 근거 없음.
  //    학칙 조(L2)나 공식 웹 원문을 근거로 인용하지 않았고, 근거로 든 법령 조의 인용이 모두 숫자 없는 학칙 위임 문구이며,
  //    결론의 숫자가 인용 원문 어디에도 없을 때. 위임 조는 위임(delegation)으로 남겨 위임 사실을 보여 준다.
  //    단, 학칙 조(L2)가 후보에 있으면(학교를 지정한 요청에만 그 학교 학칙이 들어온다) 근거 없음으로 바꾸지 않는다.
  //    학칙이 답을 정하고 있을 수 있으므로 issues에 남기고 ③에 학칙 조를 근거로 다시 쓰라고 한 번 되묻는다(프롬프트 규칙 8과 같은 조건)
  let schoolRuleUnused: ArticleCandidate[] = [];
  if (verdict !== "no_basis" && input.question && QUANTITY_QUESTION.test(input.question)) {
    const nonRef = kept.filter((c) => c.role !== "reference");
    const allDelegation =
      nonRef.length > 0 &&
      nonRef.every((c) => {
        const cand = candidates.get(c.id);
        if (!cand || cand.grade !== "L1" || extractClaimNumbers(c.quote).length) return false;
        return SCHOOL_RULE_PHRASE.test(c.quote) || (cand.delegated_to_school_rule && c.role === "delegation");
      });
    const citedText = nonRef.map((c) => candidates.get(c.id)?.text ?? "").join(" ").replace(/\s+/g, "");
    const numbersBacked = extractClaimNumbers(summary).some((n) => citedText.includes(n));
    if (allDelegation && !numbersBacked) {
      schoolRuleUnused = input.candidates.filter((c) => c.grade === "L2");
      if (schoolRuleUnused.length) {
        issues.push({
          kind: "school_rule_not_cited",
          detail: "법령 위임 조만 인용했지만 후보에 그 학교 학칙 조가 있어 '근거 없음'으로 바꾸지 않았습니다.",
        });
      } else {
        issues.push({ kind: "delegation_only", detail: "법령은 학칙에 맡기기만 하고 질문이 묻는 숫자·기간을 정하지 않아 '근거 없음'으로 바꿨습니다." });
        verdict = "no_basis";
        for (const c of kept) if (c.role === "basis") c.role = "delegation";
      }
    }
  }

  // 7. 공고에 맡긴 사항(“교육부장관이 정하여 공고”)을 근거 없음으로 끝내지 않는다. 위임 조와 공고(원문 확인 필요 포함)가 있으면 일부 답(partial)
  if (verdict === "no_basis" && !forcedNoBasis) {
    const noticeDelegated = new Set(input.noticeDelegated ?? []);
    const delegatedCited = kept.some((c) => c.role !== "reference" && noticeDelegated.has(c.id));
    const noticeAvailable = [...web.values()].some((w) => w.notice && !proposals.has(w.id));
    if (delegatedCited && noticeAvailable) {
      issues.push({ kind: "notice_delegation", detail: "공고에 맡긴 사항이라 위임 근거와 공고 확인 안내로 일부 답(partial)으로 바꿨습니다." });
      verdict = "partial";
      const pending = [...web.values()].filter((w) => w.notice?.status === "needs_source_check");
      for (const w of pending) caveats.push(`${w.title}: 원문 확인 필요(수치를 원문에서 확인하지 못했습니다).`);
    }
  }

  // 8. 학칙·훈령·시행령 조를 근거로 들었으면 그 조에 맡긴 상위 조(②가 찾아 둔 것)를 위임 인용으로 덧붙인다(두 단계까지).
  //    인용문은 상위 조 원문의 위임 문장·호 그대로다
  if (verdict !== "no_basis") {
    const cited = new Set(kept.map((c) => c.id));
    let frontier = kept.filter((c) => c.role !== "reference").map((c) => candidates.get(c.id)).filter((c): c is ArticleCandidate => Boolean(c));
    const visited = new Set(frontier.map((c) => c.id));
    for (let level = 0; level < 2 && frontier.length; level += 1) {
      const next: ArticleCandidate[] = [];
      for (const lower of frontier) {
        for (const up of lower.upper ?? []) {
          const upper = candidates.get(up.id);
          if (!upper) continue;
          // 이미 인용한 상위 조라도 그 위로는 계속 올라간다(학칙 → 시행령 제4조(인용함) → 법 제6조)
          if (cited.has(up.id)) {
            if (!visited.has(up.id)) next.push(upper);
            visited.add(up.id);
            continue;
          }
          const check = checkQuote(upper.text, up.quote);
          if (check.status !== "exact") continue;
          cited.add(up.id);
          kept.push({ id: up.id, quote: check.quote, role: "delegation" });
          issues.push({ kind: "upper_added", citation_id: up.id, detail: `${lower.law_name} ${lower.number}에 맡긴 상위 조를 위임 근거로 덧붙였습니다.` });
          visited.add(up.id);
          next.push(upper);
        }
      }
      frontier = next;
    }
  }

  // 9. 최근 개정된 조를 근거로 들었는데 결론에 그 판의 시행일이 없으면 확인 사항에 붙인다
  let amendmentNotes = 0;
  for (const c of kept) {
    if (amendmentNotes >= MAX_AMENDMENT_NOTES || c.role !== "basis") continue;
    const cand = candidates.get(c.id);
    if (!cand?.amended || cand.status !== "in_force") continue;
    const years = (Date.parse(asOf) - Date.parse(cand.effective_from)) / (365.25 * 86400e3);
    if (years < 0 || years > RECENT_AMENDMENT_YEARS || mentionsDate(summary, cand.effective_from)) continue;
    caveats.push(`${cand.law_name} ${cand.number}는 개정되어 ${formatKoreanDate(cand.effective_from)}부터 시행 중인 판입니다. 그 전 사안에 적용할지는 부칙(적용례·경과조치)을 확인해 주세요.`);
    amendmentNotes += 1;
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

  // 결론이 "근거로 제시할 수 있다"처럼 근거 여부 판단을 미루거나, 근거로 든 조문을 직접 정한 조항이 아니라고 스스로 밝히면 한 번 다시 묻는다
  const hedged = verdict !== "no_basis" && isHedgedBasis(summary);
  if (hedged) issues.push({ kind: "hedged_basis", detail: "결론이 조문을 '근거로 제시할 수 있다'처럼 에둘러 근거로 삼았거나, 근거로 든 조문을 직접 정한 조항이 아니라고 밝혔습니다." });
  // 결론이 "단서에 따라"처럼 번호 없이 조문을 가리키고, 근거로 든 조의 번호가 결론에 없으면 번호를 붙여 다시 쓰게 한다
  const basisArticles = [
    ...new Map(
      kept
        .filter((c) => c.role === "basis")
        .map((c) => candidates.get(c.id))
        .filter((c): c is ArticleCandidate => Boolean(c))
        .map((c) => [`${c.law_id}|${c.number}`, c] as const),
    ).values(),
  ];
  const unnamed = verdict !== "no_basis" ? unnamedBasisArticles(summary, basisArticles) : [];
  for (const c of unnamed) {
    issues.push({ kind: "unnamed_article", citation_id: c.id, detail: `결론이 조 번호 없이 조문을 가리켰고 근거로 든 ${c.law_name} ${c.number}의 번호가 결론에 없습니다.` });
  }
  // 업무 시작(제도 신설·근거 조항) 질문에서 근거로 든 조문 원문 어디에도 질문의 드문 개념어가 없으면, 허용 조문을 신설 근거로 든 것일 수 있어 한 번 다시 묻는다(판정은 바꾸지 않는다).
  // 드문 개념어는 법령 조문으로 고른 말이라, 학칙 조만 근거로 든 답(학칙은 말이 다를 수 있음)은 보지 않는다
  const lacksConcept =
    verdict !== "no_basis" &&
    input.scene === "initiating" &&
    (input.conceptTerms?.length ?? 0) > 0 &&
    basisArticles.some((c) => c.grade === "L1") &&
    !basisArticles.some((c) => mentionsAnyConcept(c.text, input.conceptTerms!));
  if (lacksConcept) {
    issues.push({ kind: "basis_lacks_concept", detail: "근거로 든 조문 원문에 질문의 핵심 개념어(동의어 포함)가 없습니다." });
  }
  const removalRetry = (forcedNoBasis && removed > 0) || removed >= 2;
  const needsRetry = removalRetry || hedged || schoolRuleUnused.length > 0 || unnamed.length > 0 || lacksConcept;
  const retryReasons: VerificationIssueKind[] = [];
  if (removalRetry) {
    for (const i of issues) {
      if ((i.kind === "unknown_id" || i.kind === "quote_not_found" || i.kind === "no_citations_left") && !retryReasons.includes(i.kind)) retryReasons.push(i.kind);
    }
  }
  if (hedged) retryReasons.push("hedged_basis");
  if (unnamed.length) retryReasons.push("unnamed_article");
  if (schoolRuleUnused.length) retryReasons.push("school_rule_not_cited");
  if (lacksConcept) retryReasons.push("basis_lacks_concept");
  const feedback = [
    ...issues
      .filter((i) => i.kind === "unknown_id" || i.kind === "quote_not_found" || i.kind === "not_yet_as_current")
      .map((i) => `- ${i.citation_id ?? ""}: ${i.detail}`),
    ...(hedged
      ? ["- 결론이 조문을 '근거로 제시할 수 있다'처럼 근거인지 판단을 미뤘거나, 근거로 든 조문을 질문 주제를 직접 정한 조항이 아니라고 했습니다. 질문 주제를 직접 정한 조문이 아니면 reference로 두고 '직접 근거는 아니다'라고 쓴 뒤 판정(verdict)을 다시 정하세요."]
      : []),
    ...(unnamed.length
      ? [
          `- 결론이 '단서', '…조항에 따라'처럼 조 번호 없이 조문을 가리켰습니다. 근거로 든 조(${unnamed.map((c) => `${c.law_name} ${c.number}`).join(", ")})를 결론에서 말할 때는 '제N조 단서'처럼 조 번호를 함께 쓰세요. 내용과 판정이 맞다면 바꾸지 마세요.`,
        ]
      : []),
    ...(lacksConcept
      ? [
          `- 근거(basis)로 든 조문(${basisArticles.map((c) => `${c.law_name} ${c.number}`).join(", ")}) 원문에 질문의 핵심 개념(${input.conceptTerms!.map((t) => t[0]).join(", ")})이 나오지 않습니다. 그 조문이 질문한 제도·업무 자체를 정했는지, 다른 일을 허용할 뿐인지 다시 확인하세요. 질문한 제도 자체를 정한 조문이 아니면 reference로 두고 판정(verdict)을 다시 정하세요. 직접 정한 조문이 맞으면 그대로 두세요.`,
        ]
      : []),
    ...(schoolRuleUnused.length
      ? [
          `- 법령 위임 조만 인용했습니다. 후보에 그 학교 학칙 조(${schoolRuleUnused.map((c) => c.id).join(", ")})가 있으니 질문에 답하는 학칙 조를 basis로 인용하고, 위임 조는 delegation으로 두세요. 학칙 조에도 답이 없을 때만 no_basis로 내세요.`,
        ]
      : []),
  ].join("\n");

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
    retry_reasons: retryReasons,
    feedback: feedback
      ? `${feedback}\n후보 목록의 ID와 원문 그대로의 인용만 쓰세요. 시행 예정 조문은 시행일을 결론에 쓰세요.`
      : "",
  };
}
