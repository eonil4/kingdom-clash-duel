import type { SagaIterator } from "redux-saga";
import { delay, put, select, takeLatest } from "redux-saga/effects";
import { advanceOneStep } from "@/features/arena/battleEngine";
import { battleStepApplied, beginBattle } from "@/store/arenaSlice";
import type { RootState } from "@/store";

function* runBattleAfterStart(): SagaIterator {
  while (true) {
    const state: RootState = yield select();
    const { battle, stepDelayMs } = state.arena;
    if (battle.phase !== "running") break;

    const step = advanceOneStep(battle.playerUnits, battle.enemyUnits);
    yield put(
      battleStepApplied({
        playerUnits: step.playerUnits,
        enemyUnits: step.enemyUnits,
        logEntry: step.logEntry,
        roundIncrement: step.roundIncrement,
        winner: step.winner,
        damageContribution: step.damageContribution,
      }),
    );

    const after: RootState = yield select();
    if (after.arena.battle.phase !== "running") break;

    yield delay(stepDelayMs);
  }
}

export function* battleSaga(): SagaIterator {
  yield takeLatest(beginBattle.type, runBattleAfterStart);
}
