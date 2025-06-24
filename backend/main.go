package main

import (
	"context"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	log.Println("[startup] Приложение запущено")
}

var whisperModels = map[string]string{
	"base":   "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
	"small":  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
	"medium": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
	"large":  "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large.bin",
}

func (a *App) OpenSettingsWindow() {
	log.Println("[OpenSettingsWindow] Открытие окна настроек Whisper")
	runtime.NewWindow(a.ctx, runtime.NewWindowOptions{
		Title:  "Whisper Settings",
		Width:  500,
		Height: 600,
		URL:    "/settings.html",
	})
}

func (a *App) ListModels() ([]map[string]interface{}, error) {
	log.Println("[ListModels] Получение списка моделей Whisper")
	var result []map[string]interface{}
	for name, url := range whisperModels {
		localPath := filepath.Join("models", filepath.Base(url))
		info, err := os.Stat(localPath)
		size := int64(0)
		if err == nil {
			size = info.Size()
		}
		result = append(result, map[string]interface{}{
			"name":     name,
			"url":      url,
			"local":    err == nil,
			"size":     size,
			"filename": filepath.Base(url),
		})
	}
	return result, nil
}

func (a *App) DownloadModel(ctx context.Context, name string) (string, error) {
	log.Printf("[DownloadModel] Запрошено скачивание модели: %s\n", name)
	url, ok := whisperModels[name]
	if !ok {
		log.Printf("[DownloadModel] Неизвестная модель: %s\n", name)
		return "", errors.New("unknown model")
	}
	os.MkdirAll("models", 0755)
	localPath := filepath.Join("models", filepath.Base(url))
	out, err := os.Create(localPath)
	if err != nil {
		log.Printf("[DownloadModel] Ошибка создания файла: %v\n", err)
		return "", err
	}
	defer out.Close()
	resp, err := http.Get(url)
	if err != nil {
		log.Printf("[DownloadModel] Ошибка http.Get: %v\n", err)
		return "", err
	}
	defer resp.Body.Close()
	_, err = io.Copy(out, resp.Body)
	if err != nil {
		log.Printf("[DownloadModel] Ошибка копирования: %v\n", err)
		return "", err
	}
	log.Printf("[DownloadModel] Модель %s успешно скачана\n", name)
	return localPath, nil
}

func (a *App) GenerateSubtitles(ctx context.Context, filePath string, lang string, modelName string) (string, error) {
	log.Printf("[GenerateSubtitles] Генерация субтитров: файл=%s, язык=%s, модель=%s\n", filePath, lang, modelName)
	url, ok := whisperModels[modelName]
	if !ok {
		log.Printf("[GenerateSubtitles] Неизвестная модель: %s\n", modelName)
		return "", errors.New("unknown model")
	}
	modelPath := filepath.Join("models", filepath.Base(url))
	if _, err := os.Stat(modelPath); err != nil {
		log.Printf("[GenerateSubtitles] Модель не найдена: %s\n", modelPath)
		return "", errors.New("Модель не найдена. Скачайте её в настройках.")
	}
	whisperPath := "./whisper-cli"
	outSRT := filePath + ".srt"
	_ = os.Remove(outSRT)

	if lang == "" {
		lang = "ru"
	}

	cmd := exec.Command(whisperPath, "-m", modelPath, "-f", filePath, "-otxt", "-osrt", "-l", lang)
	err := cmd.Run()
	if err != nil {
		log.Printf("[GenerateSubtitles] Ошибка запуска whisper-cli: %v\n", err)
		return "", err
	}

	srtData, err := os.ReadFile(outSRT)
	if err != nil {
		log.Printf("[GenerateSubtitles] Ошибка чтения SRT: %v\n", err)
		return "", err
	}
	log.Printf("[GenerateSubtitles] Субтитры успешно сгенерированы для файла: %s\n", filePath)
	return string(srtData), nil
}
