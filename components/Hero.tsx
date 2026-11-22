import messages from "@/messages/ko.json";
import { CheckIcon } from "./icons";

const t = messages.hero;

/**
 * 첫 화면 제목·부제. 결과 모드(compact)에서는 소개를 숨기되 h1은 화면 읽기 프로그램용으로 남겨
 * 페이지에 제목이 늘 하나 있게 한다.
 */
export function Hero({ compact }: { compact: boolean }) {
  return (
    <div>
      <h1 className={compact ? "sr-only" : "text-display font-bold text-fg"}>{t.title}</h1>
      {compact ? null : <p className="mt-2 max-w-3xl text-[0.9375rem] text-muted sm:text-base">{t.lead}</p>}
    </div>
  );
}

/** 첫 화면 맨 아래 특징 세 가지(아이콘은 장식, 글자가 정보) */
export function HeroFeatures() {
  return (
    <ul aria-label={t.featuresLabel} className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-small text-muted">
      {t.features.map((feature) => (
        <li key={feature} className="flex items-center gap-1.5">
          <CheckIcon size={16} className="text-ok-line" />
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}
