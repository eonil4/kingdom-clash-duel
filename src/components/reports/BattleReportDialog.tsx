import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import FavoriteIcon from "@mui/icons-material/Favorite";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import SportsMmaIcon from "@mui/icons-material/SportsMma";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  Divider,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import type { ArenaBattleState, GearLevels } from "@/types/arena";
import { countPlacedUnits } from "@/features/arena/combatPower";
import type { HeroPreviewSlot } from "@/features/arena/heroSlotsForReport";
import {
  reportDisplayScale,
  scaleReportValue,
  troopSupportDisplay,
} from "@/features/arena/reportMetrics";
import type { SlotSelection } from "@/features/arena/spawnUnits";
import { formatBattleInteger } from "@/utils/formatBattle";

function StatRow({ icon, label, left, right }: { icon: ReactNode; label: string; left: number; right: number }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ py: 0.35 }}>
      <Box sx={{ width: 28, display: "flex", justifyContent: "center", opacity: 0.75 }} aria-hidden>
        {icon}
      </Box>
      <Typography variant="caption" sx={{ flex: 0.9, color: "#5d4037", fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ flex: 1, textAlign: "right", fontWeight: 700, color: "#1565c0" }}>
        {formatBattleInteger(left)}
      </Typography>
      <Typography variant="body2" sx={{ flex: 1, textAlign: "right", fontWeight: 700, color: "#c62828" }}>
        {formatBattleInteger(right)}
      </Typography>
    </Stack>
  );
}

function heroTile(h: HeroPreviewSlot, side: "player" | "enemy") {
  const empty = !h.label;
  return (
    <Box textAlign="center" sx={{ flex: 1 }}>
      <Box
        sx={{
          width: "100%",
          maxWidth: 76,
          mx: "auto",
          aspectRatio: "1",
          bgcolor: empty ? "rgba(0,0,0,0.06)" : side === "player" ? "#5c6bc0" : "#e57373",
          borderRadius: 1,
          border: "2px solid #5d4037",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 800,
        }}
        aria-hidden
      >
        {empty ? "—" : h.label.charAt(0)}
      </Box>
      <Typography variant="caption" sx={{ color: "#4e342e", fontWeight: 700 }}>
        {empty ? "—" : `Lv. ${h.level}`}
      </Typography>
    </Box>
  );
}

function gearTile(level: number) {
  return (
    <Box sx={{ flex: 1, textAlign: "center" }}>
      <Box
        sx={{
          width: "100%",
          maxWidth: 76,
          mx: "auto",
          aspectRatio: "1",
          bgcolor: "#8d6e63",
          borderRadius: 1,
          border: "2px solid #4e342e",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontWeight: 800,
          fontSize: "0.7rem",
        }}
        aria-hidden
      >
        gear
      </Box>
      <Typography variant="caption" sx={{ color: "#4e342e", fontWeight: 700 }}>
        Lv. {level}
      </Typography>
    </Box>
  );
}

function sectionTitle(text: string) {
  return (
    <Typography
      variant="caption"
      sx={{ color: "#4e342e", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.6, mt: 1, display: "block" }}
    >
      {text}
    </Typography>
  );
}

export interface BattleReportDialogProps {
  open: boolean;
  onClose: () => void;
  battle: ArenaBattleState;
  playerSlots: SlotSelection;
  enemySlots: SlotSelection;
  playerGear: GearLevels;
  enemyGear: GearLevels;
  playerPower: number;
  enemyPower: number;
  playerHeroes: [HeroPreviewSlot, HeroPreviewSlot];
  enemyHeroes: [HeroPreviewSlot, HeroPreviewSlot];
  onDetailedInfo: () => void;
}

export function BattleReportDialog({
  open,
  onClose,
  battle,
  playerSlots,
  enemySlots,
  playerGear,
  enemyGear,
  playerPower,
  enemyPower,
  playerHeroes,
  enemyHeroes,
  onDetailedInfo,
}: BattleReportDialogProps) {
  const scale = reportDisplayScale(battle.totalDamageDealt);
  const rc = battle.reportCounters;

  const pHeroDmg = scaleReportValue(rc.playerHeroDamage, scale);
  const eHeroDmg = scaleReportValue(rc.enemyHeroDamage, scale);
  const pHeroTank = scaleReportValue(rc.playerHeroTaken, scale);
  const eHeroTank = scaleReportValue(rc.enemyHeroTaken, scale);
  const pHeroCc = scaleReportValue(Math.floor(rc.playerHeroDamage * 0.025 + rc.playerCc * 0.15), scale);
  const eHeroCc = scaleReportValue(Math.floor(rc.enemyHeroDamage * 0.025 + rc.enemyCc * 0.15), scale);

  const pTroopDmg = scaleReportValue(rc.playerTroopDamage, scale);
  const eTroopDmg = scaleReportValue(rc.enemyTroopDamage, scale);
  const pTroopTank = scaleReportValue(rc.playerTroopTaken, scale);
  const eTroopTank = scaleReportValue(rc.enemyTroopTaken, scale);

  const pTroopHeal = troopSupportDisplay(rc.playerTroopDamage, rc.playerTroopTaken, scale);
  const eTroopHeal = troopSupportDisplay(rc.enemyTroopDamage, rc.enemyTroopTaken, scale);

  const pCc = scaleReportValue(rc.playerCc, scale);
  const eCc = scaleReportValue(rc.enemyCc, scale);

  const pLeft = battle.playerUnits.filter((u) => u.hp > 0).length;
  const eLeft = battle.enemyUnits.filter((u) => u.hp > 0).length;

  const playerWon = battle.winner === "player";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="battle-report-title"
      slotProps={{
        backdrop: { sx: { backdropFilter: "blur(5px)" } },
      }}
      PaperProps={{
        sx: {
          borderRadius: 2,
          border: "4px solid #6d4c41",
          bgcolor: "#f4efe6",
          backgroundImage: "linear-gradient(180deg, #faf6ef 0%, #ebe4d6 100%)",
        },
      }}
    >
      <IconButton
        aria-label="Close battle report"
        onClick={onClose}
        size="small"
        sx={{
          position: "absolute",
          right: 10,
          top: 10,
          zIndex: 2,
          bgcolor: "#c62828",
          color: "#fff",
          "&:hover": { bgcolor: "#b71c1c" },
        }}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
      <DialogContent sx={{ pt: 3, pb: 3, color: "#3e2723" }}>
        <Typography
          id="battle-report-title"
          variant="h6"
          textAlign="center"
          sx={{ fontWeight: 800, color: "#4e342e", mb: 2 }}
        >
          Battle report
        </Typography>

        <Stack direction="row" spacing={0} sx={{ border: "2px solid #8d6e63", borderRadius: 1, overflow: "hidden" }}>
          <Box sx={{ flex: 1, bgcolor: "#e3f2fd", p: 1, textAlign: "center", borderRight: "1px solid #90caf9" }}>
            {playerWon && (
              <Typography component="span" sx={{ fontSize: 18 }} aria-hidden>
                👑{" "}
              </Typography>
            )}
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              You
            </Typography>
            <Stack direction="row" spacing={0.5} justifyContent="center" alignItems="center">
              <SportsMmaIcon sx={{ fontSize: 18 }} aria-hidden />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {formatBattleInteger(playerPower)}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block">
              Units {countPlacedUnits(playerSlots)}
            </Typography>
          </Box>
          <Box
            sx={{
              alignSelf: "stretch",
              px: 0.75,
              display: "flex",
              alignItems: "center",
              fontWeight: 900,
              color: "#f9a825",
              bgcolor: "#f4efe6",
              borderLeft: "1px solid #bcaaa4",
              borderRight: "1px solid #bcaaa4",
            }}
            aria-hidden
          >
            VS
          </Box>
          <Box sx={{ flex: 1, bgcolor: "#ffebee", p: 1, textAlign: "center" }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
              Opponent
            </Typography>
            <Stack direction="row" spacing={0.5} justifyContent="center" alignItems="center">
              <SportsMmaIcon sx={{ fontSize: 18 }} aria-hidden />
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {formatBattleInteger(enemyPower)}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block">
              Units {countPlacedUnits(enemySlots)}
            </Typography>
          </Box>
        </Stack>

        {sectionTitle("Heroes")}
        <Stack direction="row" spacing={2} justifyContent="space-between" sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={1} justifyContent="center" sx={{ flex: 1 }}>
            {heroTile(playerHeroes[0], "player")}
            {heroTile(playerHeroes[1], "player")}
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="center" sx={{ flex: 1 }}>
            {heroTile(enemyHeroes[0], "enemy")}
            {heroTile(enemyHeroes[1], "enemy")}
          </Stack>
        </Stack>

        {sectionTitle("Gear")}
        <Stack direction="row" spacing={2} justifyContent="space-between" sx={{ mt: 0.5 }}>
          <Stack direction="row" spacing={1} justifyContent="center" sx={{ flex: 1 }}>
            {gearTile(playerGear.weapon)}
            {gearTile(playerGear.armor)}
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="center" sx={{ flex: 1 }}>
            {gearTile(enemyGear.weapon)}
            {gearTile(enemyGear.armor)}
          </Stack>
        </Stack>

        <Divider sx={{ my: 1.5, borderColor: "#a1887f" }} />
        {sectionTitle("Hero performance")}
        <Stack sx={{ pl: 0.5 }}>
          <StatRow icon={<SportsMmaIcon fontSize="small" />} label="Damage" left={pHeroDmg} right={eHeroDmg} />
          <StatRow icon={<FavoriteIcon fontSize="small" />} label="Health" left={pHeroTank} right={eHeroTank} />
          <StatRow icon={<AddIcon fontSize="small" />} label="Healing" left={0} right={0} />
          <StatRow icon={<LinkOffIcon fontSize="small" />} label="Control" left={pHeroCc} right={eHeroCc} />
        </Stack>

        {sectionTitle("Troop performance")}
        <Stack sx={{ pl: 0.5 }}>
          <StatRow icon={<SportsMmaIcon fontSize="small" />} label="Damage" left={pTroopDmg} right={eTroopDmg} />
          <StatRow icon={<FavoriteIcon fontSize="small" />} label="Health" left={pTroopTank} right={eTroopTank} />
          <StatRow
            icon={<Typography aria-hidden>⛑</Typography>}
            label="Standing"
            left={pLeft}
            right={eLeft}
          />
          <StatRow icon={<AddIcon fontSize="small" />} label="Support" left={pTroopHeal} right={eTroopHeal} />
          <StatRow icon={<LinkOffIcon fontSize="small" />} label="Control" left={pCc} right={eCc} />
        </Stack>

        <Typography variant="caption" sx={{ display: "block", mt: 2, color: "#795548" }}>
          Damage and most rows use a display scaler (~12.3M battle total). “Standing” is surviving squads (actual
          count). “Support” is a derived practice metric.
        </Typography>

        <Button
          fullWidth
          variant="contained"
          onClick={onDetailedInfo}
          sx={{
            mt: 2,
            py: 1.2,
            bgcolor: "#f9a825",
            color: "#4e342e",
            fontWeight: 900,
            boxShadow: "0 3px 0 #b07800",
            "&:hover": { bgcolor: "#fbc02d" },
          }}
        >
          Detailed info
        </Button>
      </DialogContent>
    </Dialog>
  );
}
