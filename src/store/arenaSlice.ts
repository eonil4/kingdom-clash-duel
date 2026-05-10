import type { PayloadAction } from "@reduxjs/toolkit";
import { createSlice } from "@reduxjs/toolkit";
import type {
  ArenaBattleState,
  BattleLogEntry,
  DamageContribution,
  GearLevels,
  UnitInstance,
  UnitTemplateId,
} from "@/types/arena";
import { LANE_COUNT, type LaneIndex } from "@/types/arena";
import { advanceOneStep, MAX_BATTLE_ROUNDS } from "@/features/arena/battleEngine";
import { ARENA_SCENARIO_PRESETS } from "@/features/arena/gameExamples";
import { emptyReportCounters, mergeReportCounters } from "@/features/arena/reportMetrics";
import { resetInstanceIdCounter, spawnSide, type SlotSelection } from "@/features/arena/spawnUnits";

export { UNIT_TEMPLATES, TEMPLATE_IDS } from "@/features/arena/unitTemplates";
export type { SlotSelection } from "@/features/arena/spawnUnits";

function mergeDamage(
  total: number,
  byId: Record<string, number>,
  c: { attackerInstanceId: string; amount: number } | null,
): { total: number; byId: Record<string, number> } {
  if (!c) return { total, byId };
  const next = { ...byId };
  next[c.attackerInstanceId] = (next[c.attackerInstanceId] ?? 0) + c.amount;
  return { total: total + c.amount, byId: next };
}

interface ArenaState {
  playerSlots: SlotSelection;
  enemySlots: SlotSelection;
  playerGear: GearLevels;
  enemyGear: GearLevels;
  battle: ArenaBattleState;
  stepDelayMs: number;
}

const defaultSlots: SlotSelection = [
  "spearline",
  "spearline",
  "longbow",
  "runecaller",
  "colossus",
  "longbow",
  "champion",
];

const initialBattle: ArenaBattleState = {
  phase: "idle",
  round: 0,
  playerUnits: [],
  enemyUnits: [],
  log: [],
  winner: null,
  totalDamageDealt: 0,
  damageByAttackerId: {},
  reportCounters: emptyReportCounters(),
};

const initialState: ArenaState = {
  playerSlots: [...defaultSlots] as unknown as SlotSelection,
  enemySlots: [
    "spearline",
    "spearline",
    "spearline",
    "runecaller",
    "runecaller",
    "longbow",
    "champion",
  ] as unknown as SlotSelection,
  playerGear: { weapon: 19, armor: 20 },
  enemyGear: { weapon: 17, armor: 18 },
  battle: initialBattle,
  stepDelayMs: 520,
};

const arenaSlice = createSlice({
  name: "arena",
  initialState,
  reducers: {
    setPlayerSlot(state, action: PayloadAction<{ index: LaneIndex; unit: UnitTemplateId | null }>) {
      const { index, unit } = action.payload;
      const next = [...state.playerSlots] as (UnitTemplateId | null)[];
      next[index] = unit;
      state.playerSlots = next as unknown as SlotSelection;
    },
    setEnemySlot(state, action: PayloadAction<{ index: LaneIndex; unit: UnitTemplateId | null }>) {
      const { index, unit } = action.payload;
      const next = [...state.enemySlots] as (UnitTemplateId | null)[];
      next[index] = unit;
      state.enemySlots = next as unknown as SlotSelection;
    },
    setPlayerGear(state, action: PayloadAction<GearLevels>) {
      state.playerGear = {
        weapon: Math.min(30, Math.max(0, Math.floor(action.payload.weapon))),
        armor: Math.min(30, Math.max(0, Math.floor(action.payload.armor))),
      };
    },
    setEnemyGear(state, action: PayloadAction<GearLevels>) {
      state.enemyGear = {
        weapon: Math.min(30, Math.max(0, Math.floor(action.payload.weapon))),
        armor: Math.min(30, Math.max(0, Math.floor(action.payload.armor))),
      };
    },
    applyScenarioPreset(state, action: PayloadAction<string>) {
      const id = action.payload;
      const preset = ARENA_SCENARIO_PRESETS.find((p) => p.id === id);
      if (!preset) return;
      state.playerSlots = [...preset.playerSlots] as unknown as SlotSelection;
      state.enemySlots = [...preset.enemySlots] as unknown as SlotSelection;
      state.playerGear = { ...preset.playerGear };
      state.enemyGear = { ...preset.enemyGear };
      state.battle = { ...initialBattle };
    },
    setStepDelayMs(state, action: PayloadAction<number>) {
      state.stepDelayMs = Math.min(2000, Math.max(120, action.payload));
    },
    resetBattleUi(state) {
      state.battle = { ...initialBattle };
    },
    beginBattle(state) {
      resetInstanceIdCounter();
      const p = spawnSide("player", state.playerSlots, state.playerGear);
      const e = spawnSide("enemy", state.enemySlots, state.enemyGear);
      if (p.length === 0 || e.length === 0) {
        state.battle = {
          ...initialBattle,
          phase: "idle",
          log: [
            {
              id: "err-setup",
              text: "Place at least one unit on each side before starting.",
            },
          ],
        };
        return;
      }
      state.battle = {
        phase: "running",
        round: 0,
        playerUnits: p,
        enemyUnits: e,
        log: [
          {
            id: "start",
            text: `Practice started — ${LANE_COUNT} columns, same-column target first, then spill by column order.`,
          },
        ],
        winner: null,
        totalDamageDealt: 0,
        damageByAttackerId: {},
        reportCounters: emptyReportCounters(),
      };
    },
    battleStepApplied(
      state,
      action: PayloadAction<{
        playerUnits: UnitInstance[];
        enemyUnits: UnitInstance[];
        logEntry: BattleLogEntry | null;
        roundIncrement: number;
        winner: "player" | "enemy" | null;
        damageContribution: DamageContribution | null;
      }>,
    ) {
      const { playerUnits, enemyUnits, logEntry, roundIncrement, winner, damageContribution } = action.payload;
      state.battle.playerUnits = playerUnits;
      state.battle.enemyUnits = enemyUnits;
      if (logEntry) state.battle.log.push(logEntry);
      const { total, byId } = mergeDamage(
        state.battle.totalDamageDealt,
        state.battle.damageByAttackerId,
        damageContribution,
      );
      state.battle.totalDamageDealt = total;
      state.battle.damageByAttackerId = byId;
      state.battle.reportCounters = mergeReportCounters(state.battle.reportCounters, damageContribution);
      state.battle.round += roundIncrement;
      if (winner) {
        state.battle.phase = "ended";
        state.battle.winner = winner;
        state.battle.log.push({
          id: `end-${winner}`,
          text: winner === "player" ? "Victory — lineup worked." : "Defeat — adjust formation or gear.",
        });
      } else if (state.battle.round >= MAX_BATTLE_ROUNDS) {
        state.battle.phase = "ended";
        state.battle.winner = null;
        state.battle.log.push({
          id: "end-stale",
          text: "Step limit reached — call it a draw and adjust compositions.",
        });
      }
    },
    runFullSimulation(state) {
      resetInstanceIdCounter();
      const p = spawnSide("player", state.playerSlots, state.playerGear);
      const e = spawnSide("enemy", state.enemySlots, state.enemyGear);
      if (p.length === 0 || e.length === 0) {
        state.battle = {
          ...initialBattle,
          phase: "idle",
          log: [
            {
              id: "err-setup",
              text: "Place at least one unit on each side before simulating.",
            },
          ],
        };
        return;
      }
      let playerUnits = p;
      let enemyUnits = e;
      let round = 0;
      let totalDamage = 0;
      let damageByAttackerId: Record<string, number> = {};
      let reportCounters = emptyReportCounters();
      const freshLog: BattleLogEntry[] = [
        {
          id: "start",
          text: "Full simulation — same rules, no step delay.",
        },
      ];
      let winner: "player" | "enemy" | null = null;
      for (let i = 0; i < MAX_BATTLE_ROUNDS && !winner; i += 1) {
        const step = advanceOneStep(playerUnits, enemyUnits);
        playerUnits = step.playerUnits;
        enemyUnits = step.enemyUnits;
        if (step.logEntry) freshLog.push(step.logEntry);
        const merged = mergeDamage(totalDamage, damageByAttackerId, step.damageContribution);
        totalDamage = merged.total;
        damageByAttackerId = merged.byId;
        reportCounters = mergeReportCounters(reportCounters, step.damageContribution);
        round += step.roundIncrement;
        winner = step.winner;
        if (winner) break;
      }
      state.battle.playerUnits = playerUnits;
      state.battle.enemyUnits = enemyUnits;
      state.battle.round = round;
      state.battle.log = freshLog;
      state.battle.phase = "ended";
      state.battle.winner = winner;
      state.battle.totalDamageDealt = totalDamage;
      state.battle.damageByAttackerId = damageByAttackerId;
      state.battle.reportCounters = reportCounters;
      if (winner) {
        state.battle.log.push({
          id: `end-${winner}-sim`,
          text: winner === "player" ? "Victory — lineup worked." : "Defeat — adjust formation or gear.",
        });
      } else if (round >= MAX_BATTLE_ROUNDS) {
        state.battle.log.push({
          id: "end-stale-sim",
          text: "Step limit reached — call it a draw and adjust compositions.",
        });
      }
    },
  },
});

export const {
  setPlayerSlot,
  setEnemySlot,
  setPlayerGear,
  setEnemyGear,
  applyScenarioPreset,
  setStepDelayMs,
  resetBattleUi,
  beginBattle,
  battleStepApplied,
  runFullSimulation,
} = arenaSlice.actions;

export default arenaSlice.reducer;
