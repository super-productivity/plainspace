import { For, createMemo, createSignal } from 'solid-js';
import type { Member, PollPanel } from '@plainspace/shared';
import { api, ApiError } from '../../lib/api';
import { addToast } from '../../lib/toast';
import { Avatar } from '../ui';
import PanelCard from './PanelCard';
import panelStyles from './PanelCard.module.css';
import styles from './PollCard.module.css';

interface PollCardProps {
  panel: PollPanel;
  members: Member[];
  slug: string;
  myId: string;
}

export default function PollCard(props: PollCardProps) {
  // Track which option is in flight (gives a visual cue on the clicked option
  // while we wait for the SSE echo).
  const [votingOptionId, setVotingOptionId] = createSignal<string | null>(null);

  const myVote = createMemo(
    () => props.panel.votes.find((v) => v.memberId === props.myId)?.optionId ?? null,
  );
  const totalVotes = createMemo(() => props.panel.votes.length);
  // Block all option clicks while any single vote is in flight -- the upsert
  // happens on a unique(panel, member) row, so a second concurrent click would
  // race against the first echo.
  const optionsDisabled = () => votingOptionId() !== null;

  function voterAvatars(optionId: string): Member[] {
    // Join votes against the live members list -- skip any vote whose member
    // is no longer a member, otherwise a removed member leaves a ghost avatar.
    return props.panel.votes
      .filter((v) => v.optionId === optionId)
      .map((v) => props.members.find((m) => m.id === v.memberId))
      .filter((m): m is Member => Boolean(m));
  }

  async function handleVote(optionId: string) {
    if (optionsDisabled()) return;
    setVotingOptionId(optionId);
    const next = myVote() === optionId ? null : optionId;
    try {
      await api.votePoll(props.slug, props.panel.id, next);
    } catch (err) {
      // 404 means the panel was deleted -- panel.deleted SSE will remove the card.
      if (!(err instanceof ApiError && err.status === 404)) {
        addToast('Could not save your vote. Please try again.');
      }
    } finally {
      setVotingOptionId(null);
    }
  }

  return (
    <PanelCard
      title={props.panel.question}
      slug={props.slug}
      panelId={props.panel.id}
      label="poll"
      deleteConsequence="all its votes"
      cardTestId="poll-card"
      deleteTestId="poll-delete"
    >
      <ul class={panelStyles.list}>
        <For each={props.panel.options}>
          {(option) => {
            const avatars = createMemo(() => voterAvatars(option.id));
            const count = () => avatars().length;
            // Guard divide-by-zero when no votes yet.
            const fill = () => `${(count() / Math.max(totalVotes(), 1)) * 100}%`;
            const isMine = () => myVote() === option.id;
            const isVoting = () => votingOptionId() === option.id;

            return (
              <li class={panelStyles.row}>
                <button
                  type="button"
                  class={`${panelStyles.item} ${isMine() ? panelStyles.itemActive : ''} ${isVoting() ? panelStyles.itemBusy : ''}`}
                  onClick={() => handleVote(option.id)}
                  disabled={optionsDisabled()}
                  aria-pressed={isMine()}
                  aria-busy={isVoting() ? 'true' : undefined}
                  data-testid="poll-option"
                >
                  <span class={styles.fill} style={{ width: fill() }} aria-hidden="true" />
                  <span class={panelStyles.itemContent}>
                    <span class={panelStyles.itemText}>{option.text}</span>
                    <span class={panelStyles.itemMeta}>
                      <span class={panelStyles.itemCount} data-testid="poll-option-count">
                        {count()}
                      </span>
                      <span class={panelStyles.itemAvatars}>
                        <For each={avatars()}>
                          {(member) => (
                            <Avatar
                              name={member.displayName}
                              color={member.color}
                              size="sm"
                              letters={1}
                              data-testid="poll-voter-avatar"
                            />
                          )}
                        </For>
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          }}
        </For>
      </ul>
    </PanelCard>
  );
}
