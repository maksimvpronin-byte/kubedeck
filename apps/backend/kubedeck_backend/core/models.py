from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field


Language = Literal["system", "ru", "en"]
Theme = Literal["system", "dark", "light"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LlmSettings(BaseModel):
    enabled: bool = False
    baseUrl: str = ""
    model: str = ""
    apiKeyRef: str = ""


SshAuthMethod = Literal["agent", "password", "privateKey"]


class SshSettings(BaseModel):
    defaultUsername: str = ""
    defaultPort: int = 22
    defaultAuthMethod: SshAuthMethod = "agent"
    useJumpHost: bool = False
    jumpHost: str = ""
    jumpPort: int = 22
    jumpUsername: str = ""
    jumpAuthMethod: SshAuthMethod = "agent"


class Settings(BaseModel):
    kubectlPath: str = "kubectl"
    language: Language = "system"
    theme: Theme = "system"
    refreshIntervalSeconds: int = 10
    logsTailLines: int = 500
    secretRevealTimeoutSeconds: int = 30
    restartProblemThreshold: int = 3
    terminalFontSize: int = 13
    logsSince: str = ""
    llm: LlmSettings = Field(default_factory=LlmSettings)
    ssh: SshSettings = Field(default_factory=SshSettings)


class Cluster(BaseModel):
    id: str
    displayName: str
    kubeconfigPath: str
    lastOpened: bool = False
    createdAt: str = Field(default_factory=utc_now)
    updatedAt: str = Field(default_factory=utc_now)


class AppConfig(BaseModel):
    clusters: list[Cluster] = Field(default_factory=list)
    settings: Settings = Field(default_factory=Settings)


class ErrorInfo(BaseModel):
    code: str
    message: str
    rawStderr: str = ""
    commandPreview: str = ""


class CommandResult(BaseModel):
    ok: bool
    stdout: str = ""
    stderr: str = ""
    commandPreview: str
    returnCode: int | None = None


class ImportClusterRequest(BaseModel):
    sourcePath: str
    displayName: str | None = None


class RenameClusterRequest(BaseModel):
    displayName: str


class SettingsUpdateRequest(BaseModel):
    settings: Settings


class OperationConfirmation(BaseModel):
    clusterId: str
    action: str
    typedName: str
    namespace: str | None = None
    resource: str | None = None
    name: str | None = None
    commandPreviewHash: str | None = None


class YamlRequest(BaseModel):
    yaml: str


class ApplyYamlRequest(BaseModel):
    yaml: str
    confirmation: OperationConfirmation | None = None


class PodExecRequest(BaseModel):
    command: str
    container: str | None = None
    shell: str = "sh"
    confirmation: OperationConfirmation | None = None


class ResourceActionRequest(BaseModel):
    action: str
    replicas: int | None = None
    confirmation: OperationConfirmation | None = None


class PortForwardStartRequest(BaseModel):
    resource: str = "service"
    name: str
    namespace: str
    # localPort=0 means "auto-pick a free high local port".
    localPort: int = 0
    remotePort: int
