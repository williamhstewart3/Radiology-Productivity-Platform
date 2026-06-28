import type { DaySettings, PaceMetrics, StatusType } from "../types";

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function computeMetrics(
  currentWRVU: number,
  settings: DaySettings,
  now: Date = new Date()
): PaceMetrics {
  const startMin = parseTimeToMinutes(settings.startTime);
  const endMin = parseTimeToMinutes(settings.endTime);
  const totalWorkMinutes = Math.max(
    endMin - startMin - settings.lunchMinutes,
    1
  );

  const nowMin = now.getHours() * 60 + now.getMinutes();

  // Clamp elapsed between 0 and totalWorkMinutes
  const rawElapsed = nowMin - startMin;
  // Subtract lunch from elapsed (assume lunch taken in middle, simplification)
  const elapsedMinutes = Math.min(
    Math.max(rawElapsed - settings.lunchMinutes, 0),
    totalWorkMinutes
  );

  const expectedWRVU =
    elapsedMinutes > 0
      ? (settings.dailyGoal * elapsedMinutes) / totalWorkMinutes
      : 0;

  const projectedTotal =
    elapsedMinutes > 0
      ? (currentWRVU / elapsedMinutes) * totalWorkMinutes
      : 0;

  const remainingWRVU = Math.max(settings.dailyGoal - currentWRVU, 0);
  const remainingMinutes = Math.max(totalWorkMinutes - elapsedMinutes, 1);
  const requiredPerHour = (remainingWRVU / remainingMinutes) * 60;

  const paceDiff = currentWRVU - expectedWRVU;
  const percentOfExpected =
    expectedWRVU > 0 ? (currentWRVU / expectedWRVU) * 100 : 100;
  const percentComplete = Math.min(
    (currentWRVU / settings.dailyGoal) * 100,
    100
  );

  let status: StatusType;
  if (currentWRVU >= settings.dailyGoal) {
    status = "goal-hit";
  } else if (expectedWRVU === 0) {
    status = "on-track";
  } else if (percentOfExpected > 110) {
    status = "ahead";
  } else if (percentOfExpected >= 90) {
    status = "on-track";
  } else if (percentOfExpected >= 75) {
    status = "falling-behind";
  } else {
    status = "danger-zone";
  }

  return {
    currentWRVU,
    expectedWRVU,
    projectedTotal,
    percentComplete,
    percentOfExpected,
    remainingWRVU,
    requiredPerHour,
    elapsedMinutes,
    totalWorkMinutes,
    status,
    paceDiff,
  };
}

export const STATUS_CONFIG: Record<
  StatusType,
  {
    label: string;
    message: string;
    color: string;
    glowColor: string;
    bg: string;
    icon: string;
  }
> = {
  ahead: {
    label: "Ahead",
    message: "You're banking time.",
    color: "#22c55e",
    glowColor: "rgba(34,197,94,0.35)",
    bg: "rgba(34,197,94,0.12)",
    icon: "trending-up",
  },
  "on-track": {
    label: "On Track",
    message: "Steady. Keep the list clean.",
    color: "#3b82f6",
    glowColor: "rgba(59,130,246,0.3)",
    bg: "rgba(59,130,246,0.1)",
    icon: "check-circle",
  },
  "falling-behind": {
    label: "Falling Behind",
    message: "Need a small push.",
    color: "#f59e0b",
    glowColor: "rgba(245,158,11,0.35)",
    bg: "rgba(245,158,11,0.12)",
    icon: "alert-triangle",
  },
  "danger-zone": {
    label: "Danger Zone",
    message: "Time to prioritize high-yield studies.",
    color: "#ef4444",
    glowColor: "rgba(239,68,68,0.35)",
    bg: "rgba(239,68,68,0.12)",
    icon: "alert-octagon",
  },
  "goal-hit": {
    label: "Goal Hit",
    message: "Daily goal hit. Everything else is gravy.",
    color: "#a855f7",
    glowColor: "rgba(168,85,247,0.4)",
    bg: "rgba(168,85,247,0.12)",
    icon: "star",
  },
};
