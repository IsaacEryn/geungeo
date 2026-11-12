// 기준일 상태 계산(설계 3절). 상태는 요청마다 기준일로 계산하고 캐시에 박지 않는다.
import type { ArticleVersion, IsoDate, LawArticle } from "./schema";
import type { ArticleStatus } from "@/lib/pipeline/types";

/** 판 하나의 기준일 상태. 날짜는 'YYYY-MM-DD'라 문자열 비교로 충분하다 */
export function versionStatus(version: Pick<ArticleVersion, "effective_from" | "effective_to">, asOf: IsoDate): ArticleStatus {
  if (version.effective_from > asOf) return "not_yet";
  if (version.effective_to !== null && version.effective_to < asOf) return "superseded";
  return "in_force";
}

export interface ResolvedVersion {
  version: ArticleVersion;
  status: ArticleStatus;
}

/**
 * 기준일에 볼 판들. 시행 중인 판(있으면 하나)과 그 뒤의 시행 예정 판을 돌려준다.
 * 구판은 기준일에 시행 중인 판도 예정 판도 없을 때(폐지 등)만 마지막 구판 하나를 돌려준다.
 */
export function resolveVersions(article: Pick<LawArticle, "versions">, asOf: IsoDate): ResolvedVersion[] {
  const all = article.versions.map((version) => ({ version, status: versionStatus(version, asOf) }));
  const current = all.filter((v) => v.status === "in_force");
  const future = all.filter((v) => v.status === "not_yet");
  if (current.length || future.length) return [...current.slice(-1), ...future];
  const past = all.filter((v) => v.status === "superseded");
  return past.slice(-1);
}

/** 기준일에 시행 중인 판. 없으면 null */
export function versionInForce(article: Pick<LawArticle, "versions">, asOf: IsoDate): ArticleVersion | null {
  return resolveVersions(article, asOf).find((v) => v.status === "in_force")?.version ?? null;
}

/** 상태 배지 문구(색만으로 구분하지 않게 글자로) */
export function statusLabel(status: ArticleStatus, effectiveFrom: IsoDate): string {
  const [y, m, d] = effectiveFrom.split("-").map(Number);
  const date = `${y}. ${m}. ${d}.`;
  if (status === "not_yet") return `${date} 시행 예정`;
  if (status === "superseded") return "이전 판";
  return `시행 중(${date} 시행)`;
}
