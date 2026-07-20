import { For, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { A } from '@solidjs/router';
import type { Project, Member } from '@plainspace/shared';
import { copyJoinLink } from '../../lib/join-link';
import MemberList from '../members/MemberList';
import { Avatar } from '../ui';
import styles from './Header.module.css';

const MAX_AVATARS = 4;
const SCROLL_THRESHOLD = 24;

interface HeaderProps {
  project: Project;
  members: Member[];
  presence: string[];
  slug: string;
  myId: string;
  myRole: string;
  isCreator: boolean;
  showMembers?: boolean;
  focusEmailVerification?: boolean;
  onMembersOpenChange?: (open: boolean) => void;
}

export default function Header(props: HeaderProps) {
  const [localShowMembers, setLocalShowMembers] = createSignal(false);
  const [scrolled, setScrolled] = createSignal(false);
  let headerRef: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;

  const showMembers = () => props.showMembers ?? localShowMembers();
  const visibleMembers = () => props.members.slice(0, MAX_AVATARS);
  const overflowCount = () => Math.max(0, props.members.length - MAX_AVATARS);
  const linkLabel = 'Copy join link';

  function setMembersOpen(open: boolean) {
    if (props.onMembersOpenChange) {
      props.onMembersOpenChange(open);
      return;
    }
    setLocalShowMembers(open);
  }

  const handleScroll = () => {
    const isMobile = window.matchMedia('(max-width: 600px)').matches;
    setScrolled(!isMobile && window.scrollY > SCROLL_THRESHOLD);
  };

  onMount(() => {
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });

    if (headerRef && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (!headerRef) return;
        document.documentElement.style.setProperty(
          '--header-height',
          `${headerRef.offsetHeight}px`,
        );
      });
      resizeObserver.observe(headerRef);
    }
  });

  onCleanup(() => {
    window.removeEventListener('scroll', handleScroll);
    resizeObserver?.disconnect();
    document.documentElement.style.removeProperty('--header-height');
  });

  return (
    <>
      <header
        ref={(el) => (headerRef = el)}
        class={`${styles.header} ${scrolled() ? styles.scrolled : ''}`}
        data-testid="project-header"
      >
        <div class={styles.inner}>
          <div class={styles.titleBlock}>
            <A
              href="/spaces"
              class={styles.overviewLink}
              aria-label="Spaces overview"
              data-testid="header-spaces-overview-link"
            >
              <span aria-hidden="true">←</span>
              <span>Spaces</span>
            </A>
            <h1 class={styles.name} tabindex="-1" data-testid="project-name">
              {props.project.name}
            </h1>
            <Show when={props.project.purpose}>
              <p class={styles.purpose}>{props.project.purpose}</p>
            </Show>
          </div>

          <div class={styles.actionRow}>
            <button
              type="button"
              class={styles.memberStack}
              onClick={() => setMembersOpen(true)}
              aria-label={`${props.members.length} ${props.members.length === 1 ? 'person' : 'people'} — open people panel`}
              data-testid="presence-bar"
            >
              <span class={styles.avatarRow}>
                <For each={visibleMembers()}>
                  {(member) => {
                    const online = () => props.presence.includes(member.id);
                    return (
                      <Avatar
                        name={member.displayName}
                        color={member.color}
                        size="lg"
                        letters={1}
                        online={online()}
                        title={`${member.displayName}${online() ? ' (online)' : ''}`}
                        class={styles.stackAvatar}
                      />
                    );
                  }}
                </For>
                <Show when={overflowCount() > 0}>
                  <Avatar
                    name={`+${overflowCount()}`}
                    size="lg"
                    class={styles.stackAvatar}
                  >{`+${overflowCount()}`}</Avatar>
                </Show>
              </span>
              <span class={styles.memberCountLabel}>
                {props.members.length} {props.members.length === 1 ? 'person' : 'people'}
              </span>
            </button>

            <Show when={props.project.sharingMode === 'open'}>
              <button
                type="button"
                class={styles.linkButton}
                onClick={() => void copyJoinLink(props.slug)}
                aria-label={linkLabel}
                data-testid="space-link-button"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                <span class={styles.linkButtonLabel}>{linkLabel}</span>
              </button>
            </Show>
          </div>
        </div>
      </header>

      <Show when={showMembers()}>
        <MemberList
          project={props.project}
          members={props.members}
          presence={props.presence}
          myId={props.myId}
          myRole={props.myRole}
          isCreator={props.isCreator}
          slug={props.slug}
          focusEmailVerification={props.focusEmailVerification}
          onClose={() => setMembersOpen(false)}
        />
      </Show>
    </>
  );
}
