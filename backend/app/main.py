from fastapi import FastAPI

app = FastAPI(title="PromptSys")

@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

