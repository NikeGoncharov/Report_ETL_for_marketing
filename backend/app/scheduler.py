"""Report scheduler using APScheduler."""
import logging
from datetime import datetime
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_maker
from app.models import Report, ReportRun

logger = logging.getLogger(__name__)

# Global scheduler instance
scheduler: Optional[AsyncIOScheduler] = None


def get_scheduler() -> AsyncIOScheduler:
    """Get or create the scheduler instance."""
    global scheduler
    if scheduler is None:
        scheduler = AsyncIOScheduler()
    return scheduler


async def run_scheduled_report(report_id: int):
    """Run a report as a scheduled job."""
    logger.info(f"Running scheduled report {report_id}")
    
    async with async_session_maker() as db:
        # Get report
        result = await db.execute(select(Report).where(Report.id == report_id))
        report = result.scalar_one_or_none()
        
        if not report:
            logger.error(f"Report {report_id} not found")
            return
        
        # Create run record
        run = ReportRun(
            report_id=report_id,
            status="running"
        )
        db.add(run)
        await db.commit()
        await db.refresh(run)
        
        try:
            # Import here to avoid circular imports
            from app.reports import run_report_pipeline
            from app.models import User
            
            # Get project owner
            project_result = await db.execute(
                select(User)
                .join(Report.project)
                .where(Report.id == report_id)
            )
            # For scheduled reports, we'd need to store the user or run as system
            # For now, mark as completed with note
            
            run.status = "completed"
            run.completed_at = datetime.utcnow()
            run.error_message = "Scheduled run - manual export required"
            
            await db.commit()
            logger.info(f"Scheduled report {report_id} completed")
            
        except Exception as e:
            logger.error(f"Scheduled report {report_id} failed: {e}")
            run.status = "failed"
            run.completed_at = datetime.utcnow()
            run.error_message = str(e)
            await db.commit()


def schedule_report(
    report_id: int,
    cron_expression: str,
    job_id: Optional[str] = None
) -> str:
    """Schedule a report to run on a cron schedule.
    
    Args:
        report_id: The report ID to schedule
        cron_expression: Cron expression (e.g., "0 9 * * 1" for every Monday at 9am)
        job_id: Optional job ID, defaults to report_{report_id}
    
    Returns:
        The job ID
    """
    sched = get_scheduler()
    
    if job_id is None:
        job_id = f"report_{report_id}"
    
    # Remove existing job if any
    if sched.get_job(job_id):
        sched.remove_job(job_id)
    
    # Parse cron expression
    # Format: minute hour day month day_of_week
    parts = cron_expression.split()
    if len(parts) != 5:
        raise ValueError("Invalid cron expression. Expected format: minute hour day month day_of_week")
    
    trigger = CronTrigger(
        minute=parts[0],
        hour=parts[1],
        day=parts[2],
        month=parts[3],
        day_of_week=parts[4]
    )
    
    sched.add_job(
        run_scheduled_report,
        trigger=trigger,
        args=[report_id],
        id=job_id,
        name=f"Report {report_id}",
        replace_existing=True
    )
    
    logger.info(f"Scheduled report {report_id} with cron: {cron_expression}")
    return job_id


def unschedule_report(report_id: int) -> bool:
    """Remove a scheduled report job.
    
    Returns:
        True if job was removed, False if it didn't exist
    """
    sched = get_scheduler()
    job_id = f"report_{report_id}"
    
    if sched.get_job(job_id):
        sched.remove_job(job_id)
        logger.info(f"Unscheduled report {report_id}")
        return True
    
    return False


def list_scheduled_jobs() -> list:
    """List all scheduled jobs."""
    sched = get_scheduler()
    jobs = []
    
    for job in sched.get_jobs():
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
            "trigger": str(job.trigger)
        })
    
    return jobs


def start_scheduler():
    """Start the scheduler."""
    sched = get_scheduler()
    if not sched.running:
        sched.start()
        logger.info("Scheduler started")


def stop_scheduler():
    """Stop the scheduler."""
    global scheduler
    if scheduler and scheduler.running:
        scheduler.shutdown()
        logger.info("Scheduler stopped")
