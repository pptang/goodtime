package main

import (
	"fmt"

	"github.com/pptang/otto"
	"github.com/pptang/otto/parser"
)

func main() {
	filename := "../js/test-basic.js"
	ast, err := parser.ParseFile(nil, filename, nil, 0)
	if err != nil {
		fmt.Println(err)
		panic("Failed to parse file")
	}
	interpreter := otto.New()
	interpreter.Run(ast)
}
