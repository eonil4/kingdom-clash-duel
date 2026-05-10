import SportsKabaddiIcon from "@mui/icons-material/SportsKabaddi";
import {
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { BattleReportDialog } from "@/components/reports/BattleReportDialog";
import { VictoryReportDialog } from "@/components/reports/VictoryReportDialog";
import type { ArenaBattleState, LaneIndex, UnitTemplateId } from "@/types/arena";
import { LANE_COUNT } from "@/types/arena";
import { countPlacedUnits, estimateArmyPower } from "@/features/arena/combatPower";
import { ARENA_SCENARIO_PRESETS } from "@/features/arena/gameExamples";
import { heroSlotsForReport } from "@/features/arena/heroSlotsForReport";
import { reportDisplayScale, scaleReportValue } from "@/features/arena/reportMetrics";
import {
  applyScenarioPreset,
  beginBattle,
  resetBattleUi,
  runFullSimulation,
  setEnemyGear,
  setEnemySlot,
  setPlayerGear,
  setPlayerSlot,
  setStepDelayMs,
  TEMPLATE_IDS,
  UNIT_TEMPLATES,
} from "@/store/arenaSlice";
import type { AppDispatch, RootState } from "@/store";
import { formatBattleInteger } from "@/utils/formatBattle";

const PLAYER_COL_KEYS = Array.from({ length: LANE_COUNT }, (_, i) => ({
  slot: i as LaneIndex,
  formKey: `player-col-${i}`,
}));

const ENEMY_COL_KEYS = Array.from({ length: LANE_COUNT }, (_, i) => ({
  slot: i as LaneIndex,
  formKey: `enemy-col-${i}`,
}));

function columnLabel(i: number): string {
  return `Col ${i + 1}`;
}

function topDamager(battle: ArenaBattleState): { name: string; damage: number } | null {
  const entries = Object.entries(battle.damageByAttackerId);
  if (entries.length === 0) return null;
  let bestId = entries[0][0];
  let bestD = entries[0][1];
  for (const [id, d] of entries) {
    if (d > bestD) {
      bestD = d;
      bestId = id;
    }
  }
  const unit = [...battle.playerUnits, ...battle.enemyUnits].find((u) => u.instanceId === bestId);
  return { name: unit?.name ?? bestId, damage: bestD };
}

export function ArenaPracticePage() {
  const dispatch = useDispatch<AppDispatch>();
  const { playerSlots, enemySlots, playerGear, enemyGear, battle, stepDelayMs } = useSelector(
    (s: RootState) => s.arena,
  );

  const [victoryOpen, setVictoryOpen] = useState(false);
  const [battleReportOpen, setBattleReportOpen] = useState(false);

  const playerPower = useMemo(() => estimateArmyPower(playerSlots, playerGear), [playerSlots, playerGear]);
  const enemyPower = useMemo(() => estimateArmyPower(enemySlots, enemyGear), [enemySlots, enemyGear]);
  const playerCount = useMemo(() => countPlacedUnits(playerSlots), [playerSlots]);
  const enemyCount = useMemo(() => countPlacedUnits(enemySlots), [enemySlots]);
  const damager = useMemo(() => topDamager(battle), [battle]);

  const playerHeroes = useMemo(() => heroSlotsForReport(playerSlots, playerGear), [playerSlots, playerGear]);
  const enemyHeroes = useMemo(() => heroSlotsForReport(enemySlots, enemyGear), [enemySlots, enemyGear]);

  const reportScale = useMemo(() => reportDisplayScale(battle.totalDamageDealt), [battle.totalDamageDealt]);
  const goldReward = useMemo(() => {
    const base = battle.winner === "player" ? 5600 : 2100;
    return Math.floor(base + scaleReportValue(battle.totalDamageDealt, reportScale) * 0.00032);
  }, [battle.totalDamageDealt, battle.winner, reportScale]);
  const tokenReward = battle.winner === "player" ? 2000 : 500;

  useEffect(() => {
    if (battle.phase === "running") {
      setVictoryOpen(false);
      setBattleReportOpen(false);
    } else if (battle.phase === "ended" && battle.totalDamageDealt > 0) {
      setVictoryOpen(true);
      setBattleReportOpen(false);
    } else if (battle.phase === "idle") {
      setVictoryOpen(false);
      setBattleReportOpen(false);
    }
  }, [battle.phase, battle.totalDamageDealt]);

  const onPlayerSlot = useCallback(
    (index: LaneIndex, unit: UnitTemplateId | "") => {
      dispatch(setPlayerSlot({ index, unit: unit === "" ? null : unit }));
    },
    [dispatch],
  );

  const onEnemySlot = useCallback(
    (index: LaneIndex, unit: UnitTemplateId | "") => {
      dispatch(setEnemySlot({ index, unit: unit === "" ? null : unit }));
    },
    [dispatch],
  );

  const busy = battle.phase === "running";

  const scrollToCombatLog = useCallback(() => {
    document.getElementById("combat-log-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  return (
    <Stack spacing={3} component="section" aria-labelledby="arena-practice-heading">
      <Stack direction="row" spacing={1} alignItems="center">
        <SportsKabaddiIcon sx={{ fontSize: 40 }} aria-hidden />
        <Box>
          <Typography variant="h4" component="h1" id="arena-practice-heading">
            Arena fight practice
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Shaped like your screenshots: seven deploy columns, squad types (line / archers / mage / brute /
            champion), gear levels, and a post-fight damage summary. Original simulator — not the commercial
            game.
          </Typography>
        </Box>
      </Stack>

      <Card variant="outlined" sx={{ borderColor: "primary.dark" }}>
        <CardContent>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems="center" justifyContent="space-between">
            <Stack spacing={0.5} flex={1} alignItems={{ xs: "flex-start", sm: "center" }} direction={{ xs: "column", sm: "row" }} sx={{ width: "100%" }}>
              <Box flex={1} textAlign={{ xs: "left", sm: "right" }} sx={{ pr: { sm: 2 } }}>
                <Typography variant="caption" color="text.secondary">
                  You · units {playerCount}
                </Typography>
                <Typography variant="h6" component="p" sx={{ m: 0 }}>
                  {formatBattleInteger(playerPower)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  W Lv{playerGear.weapon} · A Lv{playerGear.armor}
                </Typography>
              </Box>
              <Typography variant="h5" sx={{ px: 1 }} aria-hidden>
                VS
              </Typography>
              <Box flex={1} textAlign={{ xs: "left", sm: "left" }} sx={{ pl: { sm: 2 } }}>
                <Typography variant="caption" color="text.secondary">
                  Sparring partner · units {enemyCount}
                </Typography>
                <Typography variant="h6" component="p" sx={{ m: 0 }}>
                  {formatBattleInteger(enemyPower)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  W Lv{enemyGear.weapon} · A Lv{enemyGear.armor}
                </Typography>
              </Box>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {ARENA_SCENARIO_PRESETS.length > 0 && (
        <FormControl fullWidth size="small">
          <InputLabel id="preset-label">Load example from /examples</InputLabel>
          <Select
            labelId="preset-label"
            label="Load example from /examples"
            value=""
            displayEmpty
            disabled={busy}
            onChange={(e) => {
              const v = e.target.value as string;
              if (v) dispatch(applyScenarioPreset(v));
            }}
          >
            <MenuItem value="">
              <em>Choose a saved scenario…</em>
            </MenuItem>
            {ARENA_SCENARIO_PRESETS.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      )}

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" gutterBottom>
            Your formation (7 columns)
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "repeat(2, minmax(0,1fr))", sm: "repeat(4, minmax(0,1fr))", md: "repeat(7, minmax(0,1fr))" },
              gap: 1,
            }}
          >
            {PLAYER_COL_KEYS.map(({ slot, formKey }) => (
              <FormControl key={formKey} fullWidth size="small">
                <InputLabel id={`player-slot-${slot}-label`}>{columnLabel(slot)}</InputLabel>
                <Select
                  labelId={`player-slot-${slot}-label`}
                  label={columnLabel(slot)}
                  value={playerSlots[slot] ?? ""}
                  onChange={(e) => onPlayerSlot(slot, e.target.value as UnitTemplateId | "")}
                  disabled={busy}
                >
                  <MenuItem value="">
                    <em>Empty</em>
                  </MenuItem>
                  {TEMPLATE_IDS.map((id) => (
                    <MenuItem key={id} value={id}>
                      {UNIT_TEMPLATES[id].name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ))}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
            Weapon / armor levels (army-wide bonus, like the gear row in arena)
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 1 }}>
            <Box flex={1}>
              <Typography variant="caption" id="pg-w-label">
                Weapon Lv {playerGear.weapon}
              </Typography>
              <Slider
                aria-labelledby="pg-w-label"
                value={playerGear.weapon}
                onChange={(_, v) => dispatch(setPlayerGear({ ...playerGear, weapon: v as number }))}
                min={0}
                max={30}
                disabled={busy}
              />
            </Box>
            <Box flex={1}>
              <Typography variant="caption" id="pg-a-label">
                Armor Lv {playerGear.armor}
              </Typography>
              <Slider
                aria-labelledby="pg-a-label"
                value={playerGear.armor}
                onChange={(_, v) => dispatch(setPlayerGear({ ...playerGear, armor: v as number }))}
                min={0}
                max={30}
                disabled={busy}
              />
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" gutterBottom>
            Sparring partner formation
          </Typography>
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "repeat(2, minmax(0,1fr))", sm: "repeat(4, minmax(0,1fr))", md: "repeat(7, minmax(0,1fr))" },
              gap: 1,
            }}
          >
            {ENEMY_COL_KEYS.map(({ slot, formKey }) => (
              <FormControl key={formKey} fullWidth size="small">
                <InputLabel id={`enemy-slot-${slot}-label`}>{columnLabel(slot)}</InputLabel>
                <Select
                  labelId={`enemy-slot-${slot}-label`}
                  label={columnLabel(slot)}
                  value={enemySlots[slot] ?? ""}
                  onChange={(e) => onEnemySlot(slot, e.target.value as UnitTemplateId | "")}
                  disabled={busy}
                >
                  <MenuItem value="">
                    <em>Empty</em>
                  </MenuItem>
                  {TEMPLATE_IDS.map((id) => (
                    <MenuItem key={id} value={id}>
                      {UNIT_TEMPLATES[id].name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ))}
          </Box>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ mt: 2 }}>
            <Box flex={1}>
              <Typography variant="caption" id="eg-w-label">
                Weapon Lv {enemyGear.weapon}
              </Typography>
              <Slider
                aria-labelledby="eg-w-label"
                value={enemyGear.weapon}
                onChange={(_, v) => dispatch(setEnemyGear({ ...enemyGear, weapon: v as number }))}
                min={0}
                max={30}
                disabled={busy}
              />
            </Box>
            <Box flex={1}>
              <Typography variant="caption" id="eg-a-label">
                Armor Lv {enemyGear.armor}
              </Typography>
              <Slider
                aria-labelledby="eg-a-label"
                value={enemyGear.armor}
                onChange={(_, v) => dispatch(setEnemyGear({ ...enemyGear, armor: v as number }))}
                min={0}
                max={30}
                disabled={busy}
              />
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" gutterBottom id="step-speed-label">
            Step animation delay: {stepDelayMs} ms
          </Typography>
          <Slider
            aria-labelledby="step-speed-label"
            value={stepDelayMs}
            onChange={(_, v) => dispatch(setStepDelayMs(v as number))}
            min={120}
            max={2000}
            step={40}
            disabled={busy}
          />
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <Button variant="contained" onClick={() => dispatch(beginBattle())} disabled={busy}>
              Battle
            </Button>
            <Button variant="outlined" onClick={() => dispatch(runFullSimulation())} disabled={busy}>
              Run full simulation
            </Button>
            <Button variant="text" onClick={() => dispatch(resetBattleUi())} disabled={busy}>
              Clear board
            </Button>
          </Stack>
        </CardContent>
      </Card>

      <VictoryReportDialog
        open={victoryOpen}
        onClose={() => setVictoryOpen(false)}
        onOpenBattleReport={() => {
          setVictoryOpen(false);
          setBattleReportOpen(true);
        }}
        battle={battle}
        topDamagerName={damager?.name ?? "—"}
        topDamagerDamage={damager?.damage ?? 0}
        playerPower={playerPower}
        enemyPower={enemyPower}
        goldReward={goldReward}
        tokenReward={tokenReward}
      />

      <BattleReportDialog
        open={battleReportOpen}
        onClose={() => setBattleReportOpen(false)}
        battle={battle}
        playerSlots={playerSlots}
        enemySlots={enemySlots}
        playerGear={playerGear}
        enemyGear={enemyGear}
        playerPower={playerPower}
        enemyPower={enemyPower}
        playerHeroes={playerHeroes}
        enemyHeroes={enemyHeroes}
        onDetailedInfo={() => {
          setBattleReportOpen(false);
          scrollToCombatLog();
        }}
      />

      <Stack direction={{ xs: "column", md: "row" }} spacing={2} alignItems="stretch" id="combat-log-panel">
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="subtitle1" gutterBottom>
              Field (HP by column)
            </Typography>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              Steps: {battle.round}
              {battle.winner && (
                <>
                  {" "}
                  · Outcome: {battle.winner === "player" ? "You" : battle.winner === "enemy" ? "Enemy" : "Draw"}
                </>
              )}
            </Typography>
            <Stack spacing={0.5} sx={{ maxHeight: 360, overflow: "auto" }}>
              {Array.from({ length: LANE_COUNT }, (_, lane) => {
                const pl = battle.playerUnits.find((u) => u.slot === lane);
                const en = battle.enemyUnits.find((u) => u.slot === lane);
                return (
                  <Box
                    key={`field-lane-${lane}`}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "1fr auto 1fr",
                      gap: 1,
                      alignItems: "center",
                      py: 0.5,
                      borderBottom: 1,
                      borderColor: "divider",
                    }}
                  >
                    <Typography variant="body2" textAlign="right">
                      {pl ? `${pl.name} ${pl.hp}/${pl.maxHp}` : "—"}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ px: 0.5 }}>
                      C{lane + 1}
                    </Typography>
                    <Typography variant="body2" textAlign="left">
                      {en ? `${en.name} ${en.hp}/${en.maxHp}` : "—"}
                    </Typography>
                  </Box>
                );
              })}
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ flex: 1, minHeight: 280 }}>
          <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <Typography variant="subtitle1" gutterBottom component="h2" id="combat-log-heading">
              Combat log
            </Typography>
            <Box
              component="div"
              role="log"
              aria-live="polite"
              aria-relevant="additions"
              sx={{
                flex: 1,
                overflow: "auto",
                bgcolor: "action.hover",
                borderRadius: 1,
                p: 1,
                maxHeight: 320,
              }}
            >
              {battle.log.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Start a fight to see actions here.
                </Typography>
              ) : (
                <Stack spacing={0.5}>
                  {battle.log.map((entry) => (
                    <Typography key={entry.id} variant="body2" component="p" sx={{ m: 0 }}>
                      {entry.text}
                    </Typography>
                  ))}
                </Stack>
              )}
            </Box>
          </CardContent>
        </Card>
      </Stack>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" gutterBottom>
            Squad cheatsheet
          </Typography>
          <Stack spacing={1}>
            {TEMPLATE_IDS.map((id) => (
              <Typography key={id} variant="body2">
                <strong>{UNIT_TEMPLATES[id].name}</strong> — {UNIT_TEMPLATES[id].description} (HP{" "}
                {UNIT_TEMPLATES[id].maxHp}, ATK {UNIT_TEMPLATES[id].attack}, ARM {UNIT_TEMPLATES[id].armor}, SPD{" "}
                {UNIT_TEMPLATES[id].speed})
              </Typography>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
