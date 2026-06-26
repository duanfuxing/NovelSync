from pydantic import BaseModel, Field


class CreateMaterialTaskRequest(BaseModel):
    title: str | None = Field(default=None, max_length=128)
    count: int = Field(ge=1)
    promptTheme: str | None = Field(default=None, max_length=1000)
    imageSize: str | None = None
    negativePrompt: str | None = Field(default=None, max_length=1000)
    promptExtend: bool = False
