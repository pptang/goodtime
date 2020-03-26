package main

import (
	"flag"
	"fmt"

	"github.com/pptang/goodtime/go/goodtime/otto"
	"github.com/pptang/goodtime/go/goodtime/otto/parser"
)

func main() {
	flag.Parse()
	filename := flag.Arg(0)
	ast, err := parser.ParseFile(nil, filename, nil, 0)
	if err != nil {
		fmt.Println(err)
		panic("Failed to parse file")
	}
	interpreter := otto.New()
	interpreter.Run(ast)
}
