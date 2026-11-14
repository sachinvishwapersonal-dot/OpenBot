import { Redirect } from "expo-router";
import { useCallback } from "react";
import { Text } from "react-native";
import {
  api,
  type Bot,
  type BotTask,
  type CheckInItem,
  ORGANIZATION,
} from "../src/api";
import { authClient } from "../src/auth";
import {
  hideItem,
  ItemCard,
  startItem,
  TaskCard,
  waitingTasks,
} from "../src/check-ins";
import { heading, muted, Problem, Screen, Section, useAction } from "../src/ui";
import { useLoad } from "../src/use-load";

/**
 * Needs you: what every Bot's check-ins found that the person hasn't started or hidden, and the
 * tasks started from them that wait on the person. A ping's notification opens here, since one ping
 * folds several Bots' items. Each row names its Bot.
 */
export default function NeedsYouScreen() {
  const { data: session, isPending } = authClient.useSession();
  const action = useAction();
  const loadItems = useCallback(
    () => api<{ suggestions: CheckInItem[] }>("/api/proactive/suggestions"),
    [],
  );
  const items = useLoad(loadItems, Boolean(session));
  const loadTasks = useCallback(async () => {
    // Every page: the count of what waits on the person is of all of them.
    const tasks: BotTask[] = [];
    let cursor: string | null = null;
    do {
      const page: { tasks: BotTask[]; nextCursor: string | null } = await api(
        `${ORGANIZATION}/tasks?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      tasks.push(...page.tasks);
      cursor = page.nextCursor;
    } while (cursor);
    return { tasks };
  }, []);
  const tasks = useLoad(loadTasks, Boolean(session));
  const loadBots = useCallback(() => api<{ agents: Bot[] }>("/api/agents"), []);
  const bots = useLoad(loadBots, Boolean(session));
  if (!session && !isPending) return <Redirect href="/" />;
  const nameOf = (agentId: string) =>
    bots.data?.agents.find((bot) => bot.id === agentId)?.name ?? "A Bot";
  const waiting = waitingTasks(tasks.data?.tasks ?? []);
  const found = items.data?.suggestions ?? [];

  return (
    <Screen
      refreshing={items.pending || tasks.pending}
      onRefresh={() => {
        void items.refresh();
        void tasks.refresh();
      }}
    >
      <Text style={heading}>Needs you</Text>
      <Problem
        message={action.error || items.error || tasks.error || bots.error}
      />
      {found.map((item) => (
        <ItemCard
          key={item.id}
          item={item}
          botName={nameOf(item.agentId)}
          busy={action.busy}
          onStart={() => {
            void action.run(`start:${item.id}`, async () => {
              await startItem(item);
              void items.refresh();
              void tasks.refresh();
            });
          }}
          onHide={() => {
            void action.run(`hide:${item.id}`, async () => {
              await hideItem(item);
              await items.refresh();
            });
          }}
        />
      ))}
      {items.data && found.length === 0 && waiting.length === 0 ? (
        <Text style={muted}>
          Nothing needs you right now. When a Bot's check-in finds something for
          you, it shows up here.
        </Text>
      ) : null}
      {waiting.length > 0 ? (
        <Section title="Tasks">
          {waiting.map((task) => (
            <TaskCard key={task.id} task={task} botName={nameOf(task.botId)} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}
