import CloseIcon from "@mui/icons-material/Close";
import MilitaryTechIcon from "@mui/icons-material/MilitaryTech";
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  IconButton,
  Stack,
  Typography,
} from "@mui/material";
import type { ArenaBattleState } from "@/types/arena";
import { reportDisplayScale, scaleReportValue } from "@/features/arena/reportMetrics";
import { formatBattleInteger, formatBattleTotal } from "@/utils/formatBattle";

export interface VictoryReportDialogProps {
  open: boolean;
  onClose: () => void;
  onOpenBattleReport: () => void;
  battle: ArenaBattleState;
  topDamagerName: string;
  topDamagerDamage: number;
  playerPower: number;
  enemyPower: number;
  goldReward: number;
  tokenReward: number;
}

export function VictoryReportDialog({
  open,
  onClose,
  onOpenBattleReport,
  battle,
  topDamagerName,
  topDamagerDamage,
  playerPower,
  enemyPower,
  goldReward,
  tokenReward,
}: VictoryReportDialogProps) {
  const scale = reportDisplayScale(battle.totalDamageDealt);
  const headlineDamage = scaleReportValue(battle.totalDamageDealt, scale);
  const topDmg = scaleReportValue(topDamagerDamage, scale);

  const playerWon = battle.winner === "player";
  const title = battle.winner === "player" ? "Victory!" : battle.winner === "enemy" ? "Defeat" : "Draw";

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="victory-report-title"
      slotProps={{
        backdrop: { sx: { backdropFilter: "blur(6px)" } },
      }}
      PaperProps={{
        sx: {
          borderRadius: 2,
          border: "3px solid",
          borderColor: "#c9a227",
          bgcolor: "#f4efe6",
          backgroundImage: "linear-gradient(180deg, #faf6ef 0%, #ebe4d6 100%)",
          overflow: "visible",
        },
      }}
    >
      <IconButton
        aria-label="Close report"
        onClick={onClose}
        size="small"
        sx={{ position: "absolute", right: 8, top: 8, zIndex: 1, color: "#5d4037" }}
      >
        <CloseIcon />
      </IconButton>
      <DialogContent sx={{ pt: 3, pb: 2, color: "#3e2723" }}>
        <Stack spacing={2} alignItems="center">
          <MilitaryTechIcon sx={{ fontSize: 56, color: "#90a4ae" }} aria-hidden />
          <Box
            sx={{
              bgcolor: "#b71c1c",
              px: 4,
              py: 0.75,
              borderRadius: 1,
              boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.2)",
              border: "1px solid #ffd54f",
            }}
          >
            <Typography id="victory-report-title" variant="h6" sx={{ color: "#fff", fontWeight: 800, letterSpacing: 1 }}>
              {title}
            </Typography>
          </Box>

          <Box sx={{ width: "100%", textAlign: "center" }}>
            <Typography variant="caption" sx={{ color: "#6d4c41", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Battle result
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="center" alignItems="center" sx={{ mt: 0.5 }}>
              <Box
                component="span"
                sx={{ width: 28, height: 28, borderRadius: 0.5, bgcolor: "#c62828", display: "inline-block" }}
                aria-hidden
              />
              <Typography variant="h4" sx={{ fontWeight: 800, color: "#3e2723" }}>
                {formatBattleTotal(headlineDamage)}
              </Typography>
            </Stack>
          </Box>

          <Box
            sx={{
              width: "100%",
              bgcolor: "#e8dfc8",
              border: "1px solid #bcaaa4",
              borderRadius: 1,
              p: 1.5,
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 1,
              alignItems: "center",
            }}
          >
            <Box
              sx={{
                width: 48,
                height: 48,
                bgcolor: playerWon ? "#4a6fa5" : "#8d6e63",
                borderRadius: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontWeight: 700,
                fontSize: "1.1rem",
              }}
              aria-hidden
            >
              {topDamagerName.charAt(0) || "?"}
            </Box>
            <Box>
              <Typography variant="caption" sx={{ color: "#5d4037", fontWeight: 700, letterSpacing: 1 }}>
                TOP DAMAGER
              </Typography>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Typography variant="body2" aria-hidden>
                  ⚔
                </Typography>
                <Typography variant="body1" sx={{ fontWeight: 700 }}>
                  {formatBattleInteger(topDmg)}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {topDamagerName}
              </Typography>
            </Box>
            <Button
              variant="contained"
              size="small"
              onClick={onOpenBattleReport}
              sx={{
                bgcolor: "#2e7d32",
                color: "#fff",
                fontWeight: 800,
                "&:hover": { bgcolor: "#1b5e20" },
              }}
            >
              Report
            </Button>
          </Box>

          <Box sx={{ width: "100%" }}>
            <Typography variant="caption" sx={{ color: "#6d4c41", textTransform: "uppercase", letterSpacing: 0.5 }}>
              Reward
            </Typography>
            <Stack direction="row" spacing={2} justifyContent="center" sx={{ mt: 1 }}>
              <Box textAlign="center">
                <Typography sx={{ fontSize: 36 }} aria-hidden>
                  🪙
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {formatBattleInteger(goldReward)}
                </Typography>
              </Box>
              <Box textAlign="center">
                <Typography sx={{ fontSize: 36 }} aria-hidden>
                  🎖
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {formatBattleInteger(tokenReward)}
                </Typography>
              </Box>
            </Stack>
          </Box>

          <Typography variant="caption" sx={{ color: "#795548", textAlign: "center" }}>
            Display power (VS strip): {formatBattleInteger(playerPower)} — {formatBattleInteger(enemyPower)}
          </Typography>

          <Button
            fullWidth
            variant="contained"
            onClick={onClose}
            sx={{
              mt: 1,
              py: 1.2,
              bgcolor: "#f9a825",
              color: "#3e2723",
              fontWeight: 900,
              fontSize: "1rem",
              boxShadow: "0 3px 0 #b07800",
              "&:hover": { bgcolor: "#fbc02d" },
            }}
          >
            Next
          </Button>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
