/**
 * Cron/scheduled tasks for SureWaka.
 * Runs on a schedule to handle recurring operations.
 */

const JOBS = {
  // Every 5 minutes: check for stale deliveries
  checkStaleDeliveries: async () => {
    console.log('⏰ Checking for stale deliveries...');
    // TODO: Find deliveries stuck in 'matched' for > 30 min
  },

  // Every hour: update driver availability
  refreshDriverAvailability: async () => {
    console.log('⏰ Refreshing driver availability...');
    // TODO: Mark inactive drivers as unavailable
  },

  // Daily at midnight: generate daily report
  generateDailyReport: async () => {
    console.log('⏰ Generating daily report...');
    // TODO: Aggregate daily metrics, send to team
  },

  // Weekly: send driver performance summaries
  weeklyDriverSummary: async () => {
    console.log('⏰ Sending weekly driver summaries...');
    // TODO: Calculate ratings, earnings, send to drivers
  },
};

export default JOBS;
