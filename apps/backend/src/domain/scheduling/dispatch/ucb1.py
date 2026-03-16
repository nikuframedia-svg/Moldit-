"""UCB1 (Upper Confidence Bound) multi-armed bandit for rule selection.

Port of scheduler/ucb1-selector.ts.
Selects between ATCS, EDD, CR, SPT, WSPT.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

ALL_RULES = ["ATCS", "EDD", "CR", "SPT", "WSPT"]


@dataclass
class ArmStats:
    total_reward: float = 0.0
    pulls: int = 0

    @property
    def avg_reward(self) -> float:
        return self.total_reward / self.pulls if self.pulls > 0 else 0.0


@dataclass
class UCB1ArmExport:
    rule: str
    avg_reward: float
    pulls: int
    ucb_score: float


class UCB1Selector:
    """UCB1 bandit for dispatch rule selection.

    Formula: Q̂(a) + c√(ln(t)/n(a))
    """

    def __init__(
        self,
        rules: list[str] | None = None,
        c: float = math.sqrt(2),
    ) -> None:
        self._rules = rules or list(ALL_RULES)
        self._c = c
        self._arms: dict[str, ArmStats] = {r: ArmStats() for r in self._rules}
        self._total_pulls = 0
        self._round_robin_idx = 0

    def select(self) -> str:
        """Select next rule. Round-robin first N, then UCB1."""
        # Round-robin phase: try each rule once
        if self._total_pulls < len(self._rules):
            rule = self._rules[self._round_robin_idx % len(self._rules)]
            self._round_robin_idx += 1
            return rule

        # UCB1 phase
        best_rule = self._rules[0]
        best_score = -float("inf")
        ln_t = math.log(self._total_pulls)

        for rule in self._rules:
            arm = self._arms[rule]
            if arm.pulls == 0:
                return rule  # unexplored
            exploitation = arm.avg_reward
            exploration = self._c * math.sqrt(ln_t / arm.pulls)
            score = exploitation + exploration
            if score > best_score:
                best_score = score
                best_rule = rule

        return best_rule

    def update(self, rule: str, reward: float) -> None:
        """Update after observing schedule quality."""
        if rule not in self._arms:
            self._arms[rule] = ArmStats()
        self._arms[rule].total_reward += reward
        self._arms[rule].pulls += 1
        self._total_pulls += 1

    def reset(self) -> None:
        self._arms = {r: ArmStats() for r in self._rules}
        self._total_pulls = 0
        self._round_robin_idx = 0

    def get_stats(self) -> list[UCB1ArmExport]:
        """Get stats for all arms."""
        ln_t = math.log(max(self._total_pulls, 1))
        result: list[UCB1ArmExport] = []
        for rule in self._rules:
            arm = self._arms[rule]
            exploration = self._c * math.sqrt(ln_t / arm.pulls) if arm.pulls > 0 else float("inf")
            result.append(
                UCB1ArmExport(
                    rule=rule,
                    avg_reward=arm.avg_reward,
                    pulls=arm.pulls,
                    ucb_score=arm.avg_reward + exploration,
                )
            )
        return result

    def export_state(self) -> dict:
        return {
            "rules": self._rules,
            "arms": {
                r: {"total_reward": a.total_reward, "pulls": a.pulls} for r, a in self._arms.items()
            },
            "total_pulls": self._total_pulls,
        }

    def import_state(self, state: dict) -> None:
        self._total_pulls = state.get("total_pulls", 0)
        arms_data = state.get("arms", {})
        for r, data in arms_data.items():
            if r in self._arms:
                self._arms[r].total_reward = data.get("total_reward", 0)
                self._arms[r].pulls = data.get("pulls", 0)


# Singleton
DISPATCH_BANDIT = UCB1Selector()
