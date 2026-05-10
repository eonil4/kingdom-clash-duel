import { configureStore } from "@reduxjs/toolkit";
import createSagaMiddleware from "redux-saga";
import arenaReducer from "@/store/arenaSlice";
import { rootSaga } from "@/store/sagas";

const sagaMiddleware = createSagaMiddleware();

export const store = configureStore({
  reducer: { arena: arenaReducer },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(sagaMiddleware),
});

sagaMiddleware.run(rootSaga);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
