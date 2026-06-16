package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "pommard",
	Short: "Taste a GitHub repository like a fine wine 🍷",
	Long: "pommard pours a wine tasting card for any GitHub repository,\n" +
		"turning its health signals into Millésime, Robe, Nez, Bouche and Finale.",
	SilenceUsage:  true,
	SilenceErrors: true,
}

// Execute runs the root command and exits non-zero on error.
func Execute(version string) {
	rootCmd.Version = version
	if err := rootCmd.Execute(); err != nil {
		fmt.Fprintln(os.Stderr, "✗ "+err.Error())
		os.Exit(1)
	}
}

func init() {
	rootCmd.AddCommand(tasteCmd)
}
