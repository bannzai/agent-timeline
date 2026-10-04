import { useState } from "react";
import type { Post, PostSession } from "../../server/src/post.js";
import {
  absoluteTimeText,
  agentLabel,
  collapsedText,
  projectName,
  relativeTimeText,
} from "./format";

/** 投稿者のアイコン。agent の種類ごとに色と文字を変え、どのセッションの agent かを見分けられるようにする。 */
export function AgentAvatar({ session }: { session: PostSession }) {
  return (
    <div
      className={`avatar avatar-${session.agent}`}
      role="img"
      aria-label={agentLabel(session)}
      data-testid="avatar"
    >
      {session.agent === "claude-code" ? "CC" : "Cx"}
    </div>
  );
}

/**
 * 投稿の上の行。投稿者 (プロジェクト名・agent の種類・ブランチ) と相対時刻を並べる。
 * timeHref を渡すと、X と同じく時刻をその投稿のスレッドへのリンクにする。
 */
export function PostHeader({
  post,
  now,
  timeHref,
  onTimeClick,
}: {
  post: Post;
  now: Date;
  timeHref?: string;
  onTimeClick?: () => void;
}) {
  const time = (
    <time dateTime={post.timestamp} title={absoluteTimeText(post.timestamp)}>
      {relativeTimeText(post.timestamp, now)}
    </time>
  );
  return (
    <div className="post-header">
      <span className="post-name">{projectName(post.session)}</span>
      <span className={`agent-badge agent-badge-${post.session.agent}`}>
        {agentLabel(post.session)}
      </span>
      {post.session.gitBranch !== null && (
        <span className="post-handle">@{post.session.gitBranch}</span>
      )}
      <span className="post-handle" aria-hidden="true">
        ·
      </span>
      {timeHref === undefined ? (
        <span className="post-handle">{time}</span>
      ) : (
        <a
          className="post-handle post-time-link"
          href={timeHref}
          onClick={(event) => {
            event.stopPropagation();
            // 修飾キー付きのクリックは、ブラウザの既定 (新しいタブで開くなど) に任せる。
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
              return;
            }
            event.preventDefault();
            onTimeClick?.();
          }}
        >
          {time}
        </a>
      )}
    </div>
  );
}

/** 人間の指示の投稿の上に出す行。X のリポストの表示と同じ位置で、agent の返答と見分けられるようにする。 */
export function HumanContext() {
  return (
    <div className="post-context" data-testid="human-context">
      <PersonIcon />
      <span>あなたの指示</span>
    </div>
  );
}

/** 投稿の本文。collapsible なら長い本文を省略し、さらに表示のボタンで全文を開く。 */
export function PostText({ text, collapsible }: { text: string; collapsible: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const shortText = collapsible && !expanded ? collapsedText(text) : null;
  return (
    <div className="post-text" data-testid="post-text">
      {shortText === null ? text : `${shortText}…`}
      {shortText !== null && (
        <button
          type="button"
          className="show-more"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(true);
          }}
        >
          さらに表示
        </button>
      )}
    </div>
  );
}

/** ツール呼び出しを 1 行に畳んだ表示。タイムラインで使い、開く操作は持たない。 */
export function ToolCallLine({ post }: { post: Post }) {
  return (
    <div className="tool-call" data-testid="tool-call">
      <ToolIcon />
      <code className="tool-call-text">{post.text}</code>
    </div>
  );
}

/** ツール呼び出しを 1 行に畳み、押すと入力と結果の要約を開く表示。スレッドで使う。 */
export function ToolCallDetails({ post }: { post: Post }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="tool-call-details">
      <button
        type="button"
        className="tool-call"
        data-testid="tool-call"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <ToolIcon />
        <code className="tool-call-text">{post.text}</code>
        <ChevronIcon />
      </button>
      {expanded && (
        <div className="tool-detail" data-testid="tool-detail">
          <div className="tool-detail-label">入力</div>
          <pre className="tool-detail-body" data-testid="tool-input">
            {post.text}
          </pre>
          <div className="tool-detail-label">結果</div>
          <pre className="tool-detail-body" data-testid="tool-result">
            {post.toolResult ?? "結果の文はありません"}
          </pre>
        </div>
      )}
    </div>
  );
}

/** 読み込み中の印。 */
export function Spinner() {
  return (
    <div className="spinner-row">
      <div className="spinner" role="status" aria-label="読み込み中" />
    </div>
  );
}

/** 人のアイコン。 */
function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5Z" />
    </svg>
  );
}

/** ツール呼び出しのアイコン (レンチ)。 */
function ToolIcon() {
  return (
    <svg viewBox="0 0 24 24" className="icon" aria-hidden="true">
      <path d="M21.7 6.3a6 6 0 0 1-7.9 7.5l-7.4 7.5a2.1 2.1 0 0 1-3-3l7.5-7.4a6 6 0 0 1 7.5-7.9l-3.6 3.6.6 2.7 2.7.6 3.6-3.6Z" />
    </svg>
  );
}

/** 開閉のアイコン (下向きの山形)。 */
function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" className="icon chevron" aria-hidden="true">
      <path d="M12 15.5 5.5 9l1.4-1.4 5.1 5.1 5.1-5.1L18.5 9 12 15.5Z" />
    </svg>
  );
}
