BINARY := pommard
BIN_DIR := bin
PKG     := github.com/maximevast/pommard

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: all build install tidy run test vet fmt clean

all: build

## build: compile the pommard binary into ./bin
build: tidy
	@mkdir -p $(BIN_DIR)
	go build -ldflags "$(LDFLAGS)" -o $(BIN_DIR)/$(BINARY) .
	@echo "→ built $(BIN_DIR)/$(BINARY) ($(VERSION))"

## install: install pommard into $GOBIN (or $GOPATH/bin)
install: tidy
	go install -ldflags "$(LDFLAGS)" .
	@echo "→ installed pommard"

## tidy: sync go.mod / go.sum
tidy:
	go mod tidy

## run: build and taste a repo, e.g. make run REPO=charmbracelet/lipgloss
REPO ?= charmbracelet/lipgloss
run:
	go run . taste $(REPO)

## test: run the test suite
test:
	go test ./...

## vet: run go vet
vet:
	go vet ./...

## fmt: gofmt all sources
fmt:
	gofmt -w .

## clean: remove build artifacts
clean:
	rm -rf $(BIN_DIR)
