import ContributionsCard from "../components/Growth/ContributionsCard";
import WeekReportCard from "../components/Growth/WeekReport";
import CoachReport from "../components/Growth/CoachReport";
import CareerGoalCard from "../components/Growth/CareerGoalCard";
import StreakCard from "../components/Growth/StreakCard";
import DailyTip from "../components/Growth/DailyTip";
import SkillAnalytics from "../components/Growth/SkillAnalytics";

export default function GrowthPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-[28px] font-bold tracking-tight m-0">我的教练</h1>

      <DailyTip />

      <CareerGoalCard />

      <StreakCard />

      <SkillAnalytics />

      <CoachReport />

      <WeekReportCard />

      <ContributionsCard />
    </div>
  );
}
