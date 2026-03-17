import ContributionsCard from "../components/Growth/ContributionsCard";
import WeekReportCard from "../components/Growth/WeekReport";
import CoachReport from "../components/Growth/CoachReport";
import CareerGoalCard from "../components/Growth/CareerGoalCard";

export default function GrowthPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-[28px] font-bold tracking-tight m-0">我的教练</h1>

      <CareerGoalCard />

      <CoachReport />

      <WeekReportCard />

      <ContributionsCard />
    </div>
  );
}
