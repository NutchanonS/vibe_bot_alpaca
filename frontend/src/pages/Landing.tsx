import Nav          from "../components/landing/Nav";
import Hero         from "../components/landing/Hero";
import Ticker       from "../components/landing/Ticker";
import EnginePipeline from "../components/landing/EnginePipeline";
import StratSection from "../components/landing/StratSection";
import ChartingDemo from "../components/landing/ChartingDemo";
import AppPagesTabs from "../components/landing/AppPagesTabs";
import Backtest     from "../components/landing/Backtest";
import StatBand     from "../components/landing/StatBand";
import FeatureGrid  from "../components/landing/FeatureGrid";
import FinalCTA     from "../components/landing/FinalCTA";
import Footer       from "../components/landing/Footer";

export default function Landing() {
  return (
    <div className="bg-bg font-display min-h-screen overflow-x-hidden">
      <Nav />
      <Hero />
      <Ticker />
      <EnginePipeline />
      <StratSection />
      <ChartingDemo />
      <AppPagesTabs />
      <Backtest />
      <StatBand />
      <FeatureGrid />
      <FinalCTA />
      <Footer />
    </div>
  );
}
