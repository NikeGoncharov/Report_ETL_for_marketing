from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Text, JSON, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    projects = relationship("Project", back_populates="user", cascade="all, delete-orphan")


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    user = relationship("User", back_populates="projects")
    integrations = relationship("Integration", back_populates="project", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="project", cascade="all, delete-orphan")


class Integration(Base):
    __tablename__ = "integrations"
    # Одна интеграция каждого типа на проект. Без ограничения check-then-insert в
    # OAuth-callback неатомарен: два параллельных callback создают дубли, и весь
    # доступ через scalar_one_or_none падает с MultipleResultsFound (HTTP 500).
    __table_args__ = (
        UniqueConstraint("project_id", "type", name="uq_integration_project_type"),
    )

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    type = Column(String(50), nullable=False)  # 'yandex_direct', 'yandex_metrika', 'google_sheets'
    access_token = Column(Text, nullable=True)
    refresh_token = Column(Text, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    account_info = Column(JSON, nullable=True)  # Store account name, ID, etc.
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    project = relationship("Project", back_populates="integrations")


class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    name = Column(String(255), nullable=False)
    config = Column(JSON, nullable=False)  # Store full report configuration
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    project = relationship("Project", back_populates="reports")
    runs = relationship("ReportRun", back_populates="report", cascade="all, delete-orphan")


class ReportRun(Base):
    __tablename__ = "report_runs"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("reports.id"), nullable=False)
    status = Column(String(50), nullable=False, default="pending")  # 'pending', 'running', 'completed', 'failed'
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    error_message = Column(Text, nullable=True)
    result_url = Column(String(500), nullable=True)  # Google Sheets URL
    # Фактический период выгрузки (пресеты резолвятся в даты на момент запуска)
    period_from = Column(String(10), nullable=True)
    period_to = Column(String(10), nullable=True)

    # Relationships
    report = relationship("Report", back_populates="runs")
