import type { SagaIterator } from "redux-saga";
import { all, fork } from "redux-saga/effects";
import { battleSaga } from "@/store/sagas/battleSaga";

export function* rootSaga(): SagaIterator {
  yield all([fork(battleSaga)]);
}
