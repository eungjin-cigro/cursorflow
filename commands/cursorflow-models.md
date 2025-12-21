# CursorFlow Models

## Overview
List available AI models supported by CursorFlow and their recommended use cases. These models are discovered from your local `cursor-agent` installation.

## Usage

```bash
cursorflow models [options]
```

## Options

| Option | Description |
|------|------|
| `--list`, `-l` | List models in a table (default) |
| `--json` | Output model list as JSON |

## Available Models

| ID | Name | Provider | Recommended Use |
|----|------|----------|-----------------|
| `sonnet-4.5` | Claude 3.7 Sonnet | Anthropic | General implementation, fast work (Most versatile) |
| `sonnet-4.5-thinking` | Claude 3.7 Sonnet (Thinking) | Anthropic | Code review, deeper reasoning (Thinking model) |
| `opus-4.5` | Claude 4.0 Opus | Anthropic | Complex tasks, high quality (Advanced) |
| `opus-4.5-thinking` | Claude 4.0 Opus (Thinking) | Anthropic | Architecture design (Premium) |
| `gpt-5.2` | GPT-5.2 | OpenAI | General tasks |
| `gpt-5.2-high` | GPT-5.2 High Reasoning | OpenAI | Advanced reasoning (High performance) |

## Model Configuration

In your task `.json` files, specify the model like this:

```json
{
  "model": "sonnet-4.5",
  "tasks": [
    {
      "name": "implement",
      "prompt": "..."
    }
  ]
}
```

## Tips

- Use the `ID` from the `cursorflow models` output in your JSON files.
- You can set a default model in `cursorflow.config.js`.
- Individual tasks within a lane can override the lane-level model.

