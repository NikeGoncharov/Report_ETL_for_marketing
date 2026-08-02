"""Фоновый прогон отчёта.

POST /run больше не выполняет выгрузку синхронно: он ставит её в работу и
отвечает 202. Раньше запрос жил дольше, чем соединение через Cloudflare Tunnel
(~100 с), и пользователь получал 524, хотя прогон доходил до конца.
"""
import asyncio
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import reports as reports_module
from app.models import Project, Report, ReportRun, User


@pytest.fixture(autouse=True)
def clean_run_state():
    """Множества прогонов живут в модуле — тесты не должны влиять друг на друга."""
    reports_module._running_reports.clear()
    reports_module._run_tasks.clear()
    yield
    reports_module._running_reports.clear()
    reports_module._run_tasks.clear()


@pytest.fixture
def background_sessions(test_engine, monkeypatch):
    """Фоновая задача открывает СВОЮ сессию — направляем её в тестовую БД."""
    maker = async_sessionmaker(test_engine, class_=AsyncSession, expire_on_commit=False)
    monkeypatch.setattr(reports_module, "async_session_maker", maker)
    return maker


@pytest_asyncio.fixture
async def running_run(db_session: AsyncSession, test_report: Report) -> ReportRun:
    """Запись прогона в статусе running."""
    run = ReportRun(
        report_id=test_report.id,
        status="running",
        period_from="2026-01-01",
        period_to="2026-01-07",
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    return run


class TestRunReturnsImmediately:
    @pytest.mark.asyncio
    async def test_run_returns_202_while_work_continues(
        self, client: AsyncClient, auth_headers, test_project, test_report
    ):
        """Ответ приходит, пока фоновая задача ещё выполняется."""
        started = asyncio.Event()
        release = asyncio.Event()

        async def fake_execute(run_id, report_id, project_id, user_id):
            started.set()
            await release.wait()
            reports_module._running_reports.discard(report_id)

        with patch.object(reports_module, "_execute_report_run", fake_execute):
            response = await client.post(
                f"/projects/{test_project.id}/reports/{test_report.id}/run",
                headers=auth_headers,
            )

            assert response.status_code == 202
            body = response.json()
            assert body["status"] == "running"
            assert body["completed_at"] is None
            assert body["result_url"] is None
            # период резолвится в даты уже при постановке в работу
            assert body["period_from"] and body["period_to"]

            # задача действительно стартовала и всё ещё не закончилась
            await asyncio.wait_for(started.wait(), timeout=2)
            tasks = list(reports_module._run_tasks)
            assert tasks and not tasks[0].done()

            release.set()
            await asyncio.gather(*tasks)

    @pytest.mark.asyncio
    async def test_second_run_of_same_report_conflicts(
        self, client: AsyncClient, auth_headers, test_project, test_report
    ):
        """Пока прогон идёт, второй запуск того же отчёта отбивается 409."""
        release = asyncio.Event()

        async def fake_execute(run_id, report_id, project_id, user_id):
            await release.wait()
            reports_module._running_reports.discard(report_id)

        with patch.object(reports_module, "_execute_report_run", fake_execute):
            first = await client.post(
                f"/projects/{test_project.id}/reports/{test_report.id}/run",
                headers=auth_headers,
            )
            assert first.status_code == 202

            second = await client.post(
                f"/projects/{test_project.id}/reports/{test_report.id}/run",
                headers=auth_headers,
            )
            assert second.status_code == 409

            tasks = list(reports_module._run_tasks)
            release.set()
            await asyncio.gather(*tasks)

    @pytest.mark.asyncio
    async def test_run_of_missing_report_leaves_no_lock(
        self, client: AsyncClient, auth_headers, test_project
    ):
        """404 не должен оставлять отчёт «занятым»."""
        response = await client.post(
            f"/projects/{test_project.id}/reports/99999/run",
            headers=auth_headers,
        )

        assert response.status_code == 404
        assert reports_module._running_reports == set()


class TestRunStatusEndpoint:
    @pytest.mark.asyncio
    async def test_returns_single_run(
        self, client: AsyncClient, auth_headers, test_project, test_report, running_run
    ):
        response = await client.get(
            f"/projects/{test_project.id}/reports/{test_report.id}/runs/{running_run.id}",
            headers=auth_headers,
        )

        assert response.status_code == 200
        body = response.json()
        assert body["id"] == running_run.id
        assert body["status"] == "running"

    @pytest.mark.asyncio
    async def test_rejects_other_project(
        self, client: AsyncClient, auth_headers, test_report, running_run
    ):
        """Статус чужого прогона не читается через другой project_id (IDOR)."""
        created = await client.post(
            "/projects", json={"name": "Other project"}, headers=auth_headers
        )
        other_project_id = created.json()["id"]

        response = await client.get(
            f"/projects/{other_project_id}/reports/{test_report.id}/runs/{running_run.id}",
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_rejects_wrong_report_id(
        self, client: AsyncClient, auth_headers, db_session: AsyncSession,
        test_project: Project, running_run: ReportRun,
    ):
        """Прогон не читается через id ЧУЖОГО отчёта того же проекта."""
        other_report = Report(project_id=test_project.id, name="Other", config={"version": 2})
        db_session.add(other_report)
        await db_session.commit()
        await db_session.refresh(other_report)

        response = await client.get(
            f"/projects/{test_project.id}/reports/{other_report.id}/runs/{running_run.id}",
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_rejects_other_user(
        self, client: AsyncClient, db_session: AsyncSession,
        test_project: Project, test_report: Report, running_run: ReportRun,
    ):
        """Чужой пользователь не читает прогон даже по правильному URL владельца.

        Фильтр по project_id в самом запросе этого НЕ ловит: проект существует и
        совпадает — держит только verify_project_access.
        """
        from app.auth import create_access_token, get_password_hash

        intruder = User(email="intruder@example.com", password_hash=get_password_hash("x" * 12))
        db_session.add(intruder)
        await db_session.commit()
        await db_session.refresh(intruder)
        headers = {"Authorization": f"Bearer {create_access_token(data={'sub': str(intruder.id)})}"}

        response = await client.get(
            f"/projects/{test_project.id}/reports/{test_report.id}/runs/{running_run.id}",
            headers=headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_requires_auth(
        self, client: AsyncClient, test_project, test_report, running_run
    ):
        response = await client.get(
            f"/projects/{test_project.id}/reports/{test_report.id}/runs/{running_run.id}"
        )

        assert response.status_code == 401


class TestBackgroundExecution:
    @pytest.mark.asyncio
    async def test_failure_is_recorded_and_lock_released(
        self, background_sessions, db_session: AsyncSession,
        test_user: User, test_project: Project, test_report: Report, running_run: ReportRun,
    ):
        """Ошибка пайплайна пишется в прогон, а отчёт освобождается для повтора."""
        from fastapi import HTTPException

        # id снимаем заранее: после expire_all обращение к атрибуту объекта —
        # ленивая догрузка вне greenlet-контекста и падение MissingGreenlet
        run_id = running_run.id
        reports_module._running_reports.add(test_report.id)

        async def boom(*args, **kwargs):
            raise HTTPException(status_code=400, detail="Пайплайн вернул 0 строк")

        with patch.object(reports_module, "run_pipeline_v2", boom):
            await reports_module._execute_report_run(
                running_run.id, test_report.id, test_project.id, test_user.id
            )

        assert reports_module._running_reports == set()

        db_session.expire_all()
        refreshed = await db_session.get(ReportRun, run_id)
        assert refreshed.status == "failed"
        assert refreshed.error_message == "Пайплайн вернул 0 строк"
        assert refreshed.completed_at is not None

    @pytest.mark.asyncio
    async def test_success_stores_result_url(
        self, background_sessions, db_session: AsyncSession,
        test_user: User, test_project: Project, test_report: Report, running_run: ReportRun,
    ):
        run_id = running_run.id
        reports_module._running_reports.add(test_report.id)

        pipeline_result = {
            "columns": ["campaignname", "cost"],
            "data": [{"campaignname": "Поиск", "cost": 100.0}],
            "row_count": 1,
        }

        with patch.object(reports_module, "run_pipeline_v2", AsyncMock(return_value=pipeline_result)), \
             patch.object(reports_module, "get_sheets_integration", AsyncMock(return_value=object())), \
             patch.object(
                 reports_module, "do_export_to_sheets",
                 AsyncMock(return_value={"spreadsheet_url": "https://docs.google.com/spreadsheets/d/abc"}),
             ):
            await reports_module._execute_report_run(
                running_run.id, test_report.id, test_project.id, test_user.id
            )

        assert reports_module._running_reports == set()

        db_session.expire_all()
        refreshed = await db_session.get(ReportRun, run_id)
        assert refreshed.status == "completed"
        assert refreshed.result_url == "https://docs.google.com/spreadsheets/d/abc"
        assert refreshed.error_message is None

    @pytest.mark.asyncio
    async def test_report_from_another_project_is_rejected(
        self, background_sessions, db_session: AsyncSession,
        test_user: User, test_report: Report, running_run: ReportRun,
    ):
        """project_id из запроса не совпал с владельцем отчёта — прогон падает."""
        run_id = running_run.id
        reports_module._running_reports.add(test_report.id)

        await reports_module._execute_report_run(
            run_id, test_report.id, 999999, test_user.id
        )

        db_session.expire_all()
        refreshed = await db_session.get(ReportRun, run_id)
        assert refreshed.status == "failed"
        assert refreshed.error_message == "Report not found"

    @pytest.mark.asyncio
    async def test_zero_rows_do_not_reach_export(
        self, background_sessions, db_session: AsyncSession,
        test_user: User, test_project: Project, test_report: Report, running_run: ReportRun,
    ):
        """Пустой результат не должен стереть клиентскую таблицу (гард жив в фоне)."""
        run_id = running_run.id
        export = AsyncMock()
        empty = {"columns": [], "data": [], "row_count": 0}

        with patch.object(reports_module, "run_pipeline_v2", AsyncMock(return_value=empty)), \
             patch.object(reports_module, "do_export_to_sheets", export):
            await reports_module._execute_report_run(
                running_run.id, test_report.id, test_project.id, test_user.id
            )

        export.assert_not_awaited()

        db_session.expire_all()
        refreshed = await db_session.get(ReportRun, run_id)
        assert refreshed.status == "failed"
        assert "0 строк" in refreshed.error_message


class TestInterruptedRuns:
    @pytest.mark.asyncio
    async def test_startup_marks_orphaned_runs_failed(
        self, background_sessions, db_session: AsyncSession, running_run: ReportRun
    ):
        """Рестарт процесса убивает фоновые задачи — их записи нельзя оставлять running."""
        run_id = running_run.id
        marked = await reports_module.mark_interrupted_runs()

        assert marked == 1

        db_session.expire_all()
        refreshed = await db_session.get(ReportRun, run_id)
        assert refreshed.status == "failed"
        assert "перезапуском" in refreshed.error_message
        assert refreshed.completed_at is not None

    @pytest.mark.asyncio
    async def test_finished_runs_are_untouched(
        self, background_sessions, db_session: AsyncSession, test_report: Report
    ):
        done = ReportRun(report_id=test_report.id, status="completed", result_url="https://x")
        db_session.add(done)
        await db_session.commit()
        await db_session.refresh(done)
        done_id = done.id

        marked = await reports_module.mark_interrupted_runs()

        assert marked == 0

        db_session.expire_all()
        refreshed = await db_session.get(ReportRun, done_id)
        assert refreshed.status == "completed"
