import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from scipy import stats
import os
import warnings
warnings.filterwarnings('ignore')

class SolarDataAnalyzer:
    """
    A comprehensive class for analyzing solar and weather data.
    All plots are saved to an output directory instead of being displayed.
    """
    
    def __init__(self, data_path=None, output_dir='output_analysis'):
        """
        Initialize the analyzer with data path and output directory.
        
        Parameters:
        -----------
        data_path : str, optional
            Path to the data file (CSV or text)
        output_dir : str
            Directory to save all output files
        """
        self.data_path = data_path
        self.output_dir = output_dir
        self.df = None
        self.df_clean = None
        
        # Create output directory if it doesn't exist
        os.makedirs(self.output_dir, exist_ok=True)
        
        # Set plotting style
        plt.style.use('seaborn-v0_8-darkgrid')
        sns.set_palette("husl")
        
    def load_data(self, data_string=None):
        """
        Load data from file or string.
        
        Parameters:
        -----------
        data_string : str, optional
            If provided, load data from string instead of file
        """
        if data_string:
            # Load from provided string (for sample data)
            self.df = pd.read_csv(pd.compat.StringIO(data_string), sep='\t')
        elif self.data_path:
            # Load from file
            if self.data_path.endswith('.csv'):
                self.df = pd.read_csv(self.data_path)
            elif self.data_path.endswith('.txt'):
                self.df = pd.read_csv(self.data_path, sep='\t')
            elif self.data_path.endswith(('.xls', '.xlsx')):
                self.df = pd.read_excel(self.data_path)
            else:
                raise ValueError("Unsupported file format")
        else:
            raise ValueError("No data source provided")
        
        # Remove Si(BPR) and Si(Wacker) columns if they exist
        columns_to_remove = ['Si (BPR)', 'Si (Wacker)', 'Si(BPR)', 'Si(Wacker)']
        for col in columns_to_remove:
            if col in self.df.columns:
                self.df.drop(columns=[col], inplace=True)
        
        # Create datetime index
        self._create_datetime_index()
        
        print(f"Data loaded successfully. Shape: {self.df.shape}")
        return self.df
    
    def _create_datetime_index(self):
        """Create datetime index from Year, Month, Day, Hour, Minute columns."""
        datetime_cols = ['Year', 'Month', 'Day', 'Hour', 'Minute']
        if all(col in self.df.columns for col in datetime_cols):
            self.df['Datetime'] = pd.to_datetime(
                self.df[datetime_cols]
            )
            self.df.set_index('Datetime', inplace=True)
        else:
            print("Warning: Datetime columns not found. Using existing index.")
    
    def preprocess_data(self):
        """Clean and preprocess the data."""
        print("\n" + "="*80)
        print("DATA PREPROCESSING")
        print("="*80)
        
        # Handle special values
        if 'Solar Zenith Angle' in self.df.columns:
            self.df['Solar Zenith Angle'] = self.df['Solar Zenith Angle'].replace(-9999, np.nan)
        
        # Create derived features
        self._create_derived_features()
        
        # Create cleaned version (remove rows with NaN in critical columns)
        critical_cols = ['GHI', 'Temperature', 'Relative Humidity']
        critical_cols = [col for col in critical_cols if col in self.df.columns]
        self.df_clean = self.df.dropna(subset=critical_cols)
        
        print(f"Original data shape: {self.df.shape}")
        print(f"Cleaned data shape: {self.df_clean.shape}")
        
        # Save preprocessing summary
        self._save_preprocessing_summary()
        
        return self.df_clean
    
    def _create_derived_features(self):
        """Create additional features for analysis."""
        # Time-based features
        self.df['Hour'] = self.df.index.hour
        self.df['Month'] = self.df.index.month
        
        # Solar features
        if all(col in self.df.columns for col in ['GHI', 'Clearsky GHI']):
            self.df['Cloud_Effect_Ratio'] = self.df['GHI'] / self.df['Clearsky GHI'].replace(0, np.nan)
        
        if all(col in self.df.columns for col in ['DHI', 'DNI']):
            self.df['DNI_DHI_Ratio'] = self.df['DNI'] / self.df['DHI'].replace(0, np.nan)
        
        # Weather features
        if 'Temperature' in self.df.columns:
            self.df['Temperature_Category'] = pd.cut(
                self.df['Temperature'],
                bins=[-np.inf, 15, 25, 35, np.inf],
                labels=['Cold', 'Cool', 'Warm', 'Hot']
            )
    
    def _save_preprocessing_summary(self):
        """Save preprocessing summary to file."""
        summary_path = os.path.join(self.output_dir, 'preprocessing_summary.txt')
        with open(summary_path, 'w') as f:
            f.write("="*80 + "\n")
            f.write("DATA PREPROCESSING SUMMARY\n")
            f.write("="*80 + "\n\n")
            
            f.write(f"Original dataset shape: {self.df.shape}\n")
            f.write(f"Cleaned dataset shape: {self.df_clean.shape}\n")
            f.write(f"Date range: {self.df.index.min()} to {self.df.index.max()}\n\n")
            
            f.write("Missing values in original data:\n")
            f.write(str(self.df.isnull().sum()) + "\n\n")
            
            f.write("Data types:\n")
            f.write(str(self.df.dtypes) + "\n\n")
            
            f.write("Sample of cleaned data (first 5 rows):\n")
            f.write(str(self.df_clean.head()) + "\n")
        
        print(f"Preprocessing summary saved to: {summary_path}")
    
    def generate_basic_statistics(self):
        """Generate and save basic statistics."""
        print("\n" + "="*80)
        print("GENERATING BASIC STATISTICS")
        print("="*80)
        
        if self.df_clean is None:
            self.preprocess_data()
        
        # Select numeric columns
        numeric_cols = self.df_clean.select_dtypes(include=[np.number]).columns.tolist()
        
        # Generate statistics
        stats_df = self.df_clean[numeric_cols].describe().round(2)
        
        # Save to CSV
        stats_path = os.path.join(self.output_dir, 'basic_statistics.csv')
        stats_df.to_csv(stats_path)
        
        # Also save as text for readability
        txt_path = os.path.join(self.output_dir, 'basic_statistics.txt')
        with open(txt_path, 'w') as f:
            f.write("="*80 + "\n")
            f.write("BASIC STATISTICS\n")
            f.write("="*80 + "\n\n")
            f.write(stats_df.to_string())
        
        print(f"Basic statistics saved to: {stats_path}")
        print(f"Text statistics saved to: {txt_path}")
        
        return stats_df
    
    def correlation_analysis(self):
        """Perform and save correlation analysis."""
        print("\n" + "="*80)
        print("CORRELATION ANALYSIS")
        print("="*80)
        
        if self.df_clean is None:
            self.preprocess_data()
        
        # Select key variables for correlation
        correlation_vars = [
            'Temperature', 'Clearsky GHI', 'GHI', 'Relative Humidity',
            'Solar Zenith Angle', 'Cloud_Effect_Ratio', 'DHI', 'DNI'
        ]
        
        # Filter to existing columns
        correlation_vars = [col for col in correlation_vars if col in self.df_clean.columns]
        
        if len(correlation_vars) < 2:
            print("Warning: Not enough variables for correlation analysis")
            return None
        
        # Calculate correlation matrix
        corr_matrix = self.df_clean[correlation_vars].corr()
        
        # Save correlation matrix to CSV
        corr_path = os.path.join(self.output_dir, 'correlation_matrix.csv')
        corr_matrix.to_csv(corr_path)
        
        # Create and save correlation heatmap
        fig, ax = plt.subplots(figsize=(12, 10))
        sns.heatmap(corr_matrix, annot=True, cmap='coolwarm', center=0, 
                   fmt='.2f', ax=ax, square=True, cbar_kws={"shrink": 0.8})
        ax.set_title('Correlation Matrix of Key Variables', fontsize=16, fontweight='bold')
        plt.xticks(rotation=45, ha='right')
        plt.yticks(rotation=0)
        plt.tight_layout()
        
        heatmap_path = os.path.join(self.output_dir, 'correlation_heatmap.png')
        plt.savefig(heatmap_path, dpi=300, bbox_inches='tight')
        plt.close(fig)
        
        # Calculate and save top correlations
        corr_series = corr_matrix.unstack()
        top_pos = corr_series[corr_series < 1].sort_values(ascending=False).head(10)
        top_neg = corr_series.sort_values().head(10)
        
        # Save top correlations to text file
        corr_summary_path = os.path.join(self.output_dir, 'correlation_summary.txt')
        with open(corr_summary_path, 'w') as f:
            f.write("="*80 + "\n")
            f.write("CORRELATION ANALYSIS SUMMARY\n")
            f.write("="*80 + "\n\n")
            
            f.write("Top 10 Positive Correlations:\n")
            f.write("="*40 + "\n")
            for (var1, var2), value in top_pos.items():
                f.write(f"{var1} - {var2}: {value:.3f}\n")
            
            f.write("\n" + "="*40 + "\n")
            f.write("Top 10 Negative Correlations:\n")
            f.write("="*40 + "\n")
            for (var1, var2), value in top_neg.items():
                f.write(f"{var1} - {var2}: {value:.3f}\n")
        
        print(f"Correlation matrix saved to: {corr_path}")
        print(f"Correlation heatmap saved to: {heatmap_path}")
        print(f"Correlation summary saved to: {corr_summary_path}")
        
        return corr_matrix
    
    def time_series_analysis(self):
        """Generate and save time series plots."""
        print("\n" + "="*80)
        print("TIME SERIES ANALYSIS")
        print("="*80)
        
        if self.df_clean is None:
            self.preprocess_data()
        
        # Create subplots for time series analysis
        fig, axes = plt.subplots(3, 2, figsize=(15, 12))
        
        # 1. Temperature over time
        if 'Temperature' in self.df_clean.columns:
            axes[0, 0].plot(self.df_clean.index, self.df_clean['Temperature'], 
                           linewidth=1.5, alpha=0.8)
            axes[0, 0].set_title('Temperature Variation', fontweight='bold')
            axes[0, 0].set_ylabel('Temperature (°C)')
            axes[0, 0].grid(True, alpha=0.3)
            axes[0, 0].tick_params(rotation=45)
        
        # 2. GHI vs Clearsky GHI
        if all(col in self.df_clean.columns for col in ['GHI', 'Clearsky GHI']):
            axes[0, 1].plot(self.df_clean.index, self.df_clean['GHI'], 
                           label='Actual GHI', linewidth=1.5, alpha=0.8)
            axes[0, 1].plot(self.df_clean.index, self.df_clean['Clearsky GHI'], 
                           label='Clearsky GHI', linewidth=1.5, alpha=0.8)
            axes[0, 1].set_title('Actual vs Clearsky GHI', fontweight='bold')
            axes[0, 1].set_ylabel('GHI (W/m²)')
            axes[0, 1].legend(fontsize='small')
            axes[0, 1].grid(True, alpha=0.3)
            axes[0, 1].tick_params(rotation=45)
        
        # 3. Solar Irradiance Components
        irradiance_cols = ['DHI', 'DNI', 'GHI']
        existing_irradiance = [col for col in irradiance_cols if col in self.df_clean.columns]
        if len(existing_irradiance) > 0:
            for col in existing_irradiance:
                axes[1, 0].plot(self.df_clean.index, self.df_clean[col], 
                               label=col, linewidth=1.5, alpha=0.7)
            axes[1, 0].set_title('Solar Irradiance Components', fontweight='bold')
            axes[1, 0].set_ylabel('Irradiance (W/m²)')
            axes[1, 0].legend(fontsize='small')
            axes[1, 0].grid(True, alpha=0.3)
            axes[1, 0].tick_params(rotation=45)
        
        # 4. Relative Humidity
        if 'Relative Humidity' in self.df_clean.columns:
            axes[1, 1].plot(self.df_clean.index, self.df_clean['Relative Humidity'], 
                           color='blue', linewidth=1.5, alpha=0.7)
            axes[1, 1].set_title('Relative Humidity', fontweight='bold')
            axes[1, 1].set_ylabel('Humidity (%)')
            axes[1, 1].grid(True, alpha=0.3)
            axes[1, 1].tick_params(rotation=45)
        
        # 5. Solar Angles
        angle_cols = ['Solar Zenith Angle', 'Solar Azimuth Angle']
        existing_angles = [col for col in angle_cols if col in self.df_clean.columns]
        if len(existing_angles) > 0:
            for col in existing_angles:
                axes[2, 0].plot(self.df_clean.index, self.df_clean[col], 
                               label=col, linewidth=1.5, alpha=0.8)
            axes[2, 0].set_title('Solar Angles', fontweight='bold')
            axes[2, 0].set_ylabel('Angle (degrees)')
            axes[2, 0].legend(fontsize='small')
            axes[2, 0].grid(True, alpha=0.3)
            axes[2, 0].tick_params(rotation=45)
        
        # 6. Cloud Effect Ratio
        if 'Cloud_Effect_Ratio' in self.df_clean.columns:
            axes[2, 1].plot(self.df_clean.index, self.df_clean['Cloud_Effect_Ratio'], 
                           linewidth=1.5, alpha=0.7)
            axes[2, 1].set_title('Cloud Effect Ratio', fontweight='bold')
            axes[2, 1].set_ylabel('Ratio (Actual/Clearsky)')
            axes[2, 1].grid(True, alpha=0.3)
            axes[2, 1].tick_params(rotation=45)
        
        plt.tight_layout()
        ts_path = os.path.join(self.output_dir, 'time_series_analysis.png')
        plt.savefig(ts_path, dpi=300, bbox_inches='tight')
        plt.close(fig)
        
        print(f"Time series analysis plot saved to: {ts_path}")
        
        return ts_path
    
    def scatter_plot_analysis(self):
        """Generate and save scatter plots."""
        print("\n" + "="*80)
        print("SCATTER PLOT ANALYSIS")
        print("="*80)
        
        if self.df_clean is None:
            self.preprocess_data()
        
        # Create scatter plots
        fig, axes = plt.subplots(2, 3, figsize=(18, 10))
        
        scatter_plots = []
        
        # 1. Temperature vs GHI
        if all(col in self.df_clean.columns for col in ['Temperature', 'GHI']):
            axes[0, 0].scatter(self.df_clean['Temperature'], self.df_clean['GHI'], 
                              alpha=0.6, s=30)
            axes[0, 0].set_xlabel('Temperature (°C)')
            axes[0, 0].set_ylabel('GHI (W/m²)')
            axes[0, 0].set_title('Temperature vs GHI', fontweight='bold')
            axes[0, 0].grid(True, alpha=0.3)
            scatter_plots.append(('Temperature_vs_GHI', axes[0, 0]))
        
        # 2. Humidity vs GHI
        if all(col in self.df_clean.columns for col in ['Relative Humidity', 'GHI']):
            axes[0, 1].scatter(self.df_clean['Relative Humidity'], self.df_clean['GHI'], 
                              alpha=0.6, s=30)
            axes[0, 1].set_xlabel('Relative Humidity (%)')
            axes[0, 1].set_ylabel('GHI (W/m²)')
            axes[0, 1].set_title('Humidity vs GHI', fontweight='bold')
            axes[0, 1].grid(True, alpha=0.3)
            scatter_plots.append(('Humidity_vs_GHI', axes[0, 1]))
        
        # 3. Solar Zenith Angle vs GHI
        if all(col in self.df_clean.columns for col in ['Solar Zenith Angle', 'GHI']):
            valid_data = self.df_clean.dropna(subset=['Solar Zenith Angle', 'GHI'])
            if len(valid_data) > 0:
                axes[0, 2].scatter(valid_data['Solar Zenith Angle'], valid_data['GHI'], 
                                  alpha=0.6, s=30)
                axes[0, 2].set_xlabel('Solar Zenith Angle (degrees)')
                axes[0, 2].set_ylabel('GHI (W/m²)')
                axes[0, 2].set_title('Solar Zenith Angle vs GHI', fontweight='bold')
                axes[0, 2].invert_xaxis()
                axes[0, 2].grid(True, alpha=0.3)
                scatter_plots.append(('SolarZenith_vs_GHI', axes[0, 2]))
        
        # 4. DHI vs DNI
        if all(col in self.df_clean.columns for col in ['DHI', 'DNI']):
            daytime_data = self.df_clean[self.df_clean['GHI'] > 0] if 'GHI' in self.df_clean.columns else self.df_clean
            axes[1, 0].scatter(daytime_data['DHI'], daytime_data['DNI'], 
                              alpha=0.6, s=30)
            axes[1, 0].set_xlabel('DHI (W/m²)')
            axes[1, 0].set_ylabel('DNI (W/m²)')
            axes[1, 0].set_title('DHI vs DNI', fontweight='bold')
            axes[1, 0].grid(True, alpha=0.3)
            scatter_plots.append(('DHI_vs_DNI', axes[1, 0]))
        
        # 5. Temperature vs Humidity
        if all(col in self.df_clean.columns for col in ['Temperature', 'Relative Humidity']):
            axes[1, 1].scatter(self.df_clean['Temperature'], self.df_clean['Relative Humidity'], 
                              alpha=0.6, s=30)
            axes[1, 1].set_xlabel('Temperature (°C)')
            axes[1, 1].set_ylabel('Relative Humidity (%)')
            axes[1, 1].set_title('Temperature vs Humidity', fontweight='bold')
            axes[1, 1].grid(True, alpha=0.3)
            scatter_plots.append(('Temperature_vs_Humidity', axes[1, 1]))
        
        # 6. GHI vs Cloud Effect Ratio
        if all(col in self.df_clean.columns for col in ['GHI', 'Cloud_Effect_Ratio']):
            axes[1, 2].scatter(self.df_clean['GHI'], self.df_clean['Cloud_Effect_Ratio'], 
                              alpha=0.6, s=30)
            axes[1, 2].set_xlabel('GHI (W/m²)')
            axes[1, 2].set_ylabel('Cloud Effect Ratio')
            axes[1, 2].set_title('GHI vs Cloud Effect', fontweight='bold')
            axes[1, 2].grid(True, alpha=0.3)
            scatter_plots.append(('GHI_vs_CloudEffect', axes[1, 2]))
        
        plt.tight_layout()
        scatter_path = os.path.join(self.output_dir, 'scatter_plot_analysis.png')
        plt.savefig(scatter_path, dpi=300, bbox_inches='tight')
        plt.close(fig)
        
        # Save individual scatter plots
        for name, ax in scatter_plots:
            fig, single_ax = plt.subplots(figsize=(8, 6))
            
            # Recreate the scatter plot
            data_points = ax.collections[0]
            x_data = data_points.get_offsets()[:, 0]
            y_data = data_points.get_offsets()[:, 1]
            
            single_ax.scatter(x_data, y_data, alpha=0.6, s=30)
            single_ax.set_xlabel(ax.get_xlabel())
            single_ax.set_ylabel(ax.get_ylabel())
            single_ax.set_title(ax.get_title(), fontweight='bold')
            single_ax.grid(True, alpha=0.3)
            
            # Add trend line if there's enough data
            if len(x_data) > 1:
                z = np.polyfit(x_data, y_data, 1)
                p = np.poly1d(z)
                single_ax.plot(np.sort(x_data), p(np.sort(x_data)), 
                              "r--", alpha=0.8, label='Trend Line')
                single_ax.legend()
            
            individual_path = os.path.join(self.output_dir, f'scatter_{name}.png')
            plt.tight_layout()
            plt.savefig(individual_path, dpi=300, bbox_inches='tight')
            plt.close(fig)
        
        print(f"Scatter plot analysis saved to: {scatter_path}")
        
        return scatter_path
    
    def distribution_analysis(self):
        """Generate and save distribution plots."""
        print("\n" + "="*80)
        print("DISTRIBUTION ANALYSIS")
        print("="*80)
        
        if self.df_clean is None:
            self.preprocess_data()
        
        # Select key variables for distribution analysis
        dist_vars = ['Temperature', 'GHI', 'Relative Humidity', 
                    'DHI', 'DNI', 'Cloud_Effect_Ratio']
        dist_vars = [col for col in dist_vars if col in self.df_clean.columns]
        
        if len(dist_vars) == 0:
            print("No variables available for distribution analysis")
            return None
        
        fig, axes = plt.subplots(2, 3, figsize=(18, 10))
        axes = axes.flatten()
        
        distribution_stats = {}
        
        for idx, var in enumerate(dist_vars):
            if idx < len(axes):
                ax = axes[idx]
                data_to_plot = self.df_clean[var].dropna()
                
                if len(data_to_plot) > 0:
                    # Plot histogram
                    n, bins, patches = ax.hist(data_to_plot, bins=20, alpha=0.7, 
                                              edgecolor='black', density=True)
                    
                    # Add KDE
                    from scipy.stats import gaussian_kde
                    kde = gaussian_kde(data_to_plot)
                    x_range = np.linspace(data_to_plot.min(), data_to_plot.max(), 100)
                    ax.plot(x_range, kde(x_range), 'r-', linewidth=2, label='KDE')
                    
                    ax.set_xlabel(var)
                    ax.set_ylabel('Density')
                    ax.set_title(f'Distribution of {var}', fontweight='bold')
                    ax.grid(True, alpha=0.3)
                    ax.legend()
                    
                    # Calculate statistics
                    stats_dict = {
                        'mean': data_to_plot.mean(),
                        'std': data_to_plot.std(),
                        'min': data_to_plot.min(),
                        'max': data_to_plot.max(),
                        'median': data_to_plot.median(),
                        'skewness': data_to_plot.skew(),
                        'kurtosis': data_to_plot.kurtosis()
                    }
                    distribution_stats[var] = stats_dict
                    
                    # Add statistics to plot
                    stats_text = f'Mean: {stats_dict["mean"]:.2f}\nStd: {stats_dict["std"]:.2f}\nSkew: {stats_dict["skewness"]:.2f}'
                    ax.text(0.02, 0.98, stats_text, transform=ax.transAxes,
                           fontsize=9, verticalalignment='top',
                           bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.5))
        
        # Hide empty subplots
        for idx in range(len(dist_vars), len(axes)):
            axes[idx].set_visible(False)
        
        plt.tight_layout()
        dist_path = os.path.join(self.output_dir, 'distribution_analysis.png')
        plt.savefig(dist_path, dpi=300, bbox_inches='tight')
        plt.close(fig)
        
        # Save distribution statistics
        dist_stats_path = os.path.join(self.output_dir, 'distribution_statistics.csv')
        stats_df = pd.DataFrame(distribution_stats).T.round(3)
        stats_df.to_csv(dist_stats_path)
        
        print(f"Distribution analysis plot saved to: {dist_path}")
        print(f"Distribution statistics saved to: {dist_stats_path}")
        
        return dist_path, stats_df
    
    def generate_summary_report(self):
        """Generate a comprehensive summary report."""
        print("\n" + "="*80)
        print("GENERATING SUMMARY REPORT")
        print("="*80)
        
        if self.df_clean is None:
            self.preprocess_data()
        
        report_path = os.path.join(self.output_dir, 'comprehensive_summary_report.txt')
        
        with open(report_path, 'w') as f:
            f.write("="*80 + "\n")
            f.write("COMPREHENSIVE SOLAR DATA ANALYSIS REPORT\n")
            f.write("="*80 + "\n\n")
            
            # 1. Dataset Overview
            f.write("1. DATASET OVERVIEW\n")
            f.write("-"*40 + "\n")
            f.write(f"Total records: {len(self.df)}\n")
            f.write(f"Cleaned records: {len(self.df_clean)}\n")
            f.write(f"Date range: {self.df.index.min()} to {self.df.index.max()}\n")
            f.write(f"Variables analyzed: {len(self.df_clean.columns)}\n\n")
            
            # 2. Key Metrics Summary
            f.write("2. KEY PERFORMANCE METRICS\n")
            f.write("-"*40 + "\n")
            
            metrics = {}
            
            # Solar metrics
            if 'GHI' in self.df_clean.columns:
                metrics['Average GHI'] = f"{self.df_clean['GHI'].mean():.2f} W/m²"
                metrics['Max GHI'] = f"{self.df_clean['GHI'].max():.2f} W/m²"
                metrics['GHI Variability'] = f"{self.df_clean['GHI'].std()/self.df_clean['GHI'].mean()*100:.1f}%"
            
            if 'Cloud_Effect_Ratio' in self.df_clean.columns:
                metrics['Avg Cloud Effect'] = f"{self.df_clean['Cloud_Effect_Ratio'].mean():.2f}"
            
            # Weather metrics
            if 'Temperature' in self.df_clean.columns:
                metrics['Avg Temperature'] = f"{self.df_clean['Temperature'].mean():.2f} °C"
                metrics['Temp Range'] = f"{self.df_clean['Temperature'].min():.1f} to {self.df_clean['Temperature'].max():.1f} °C"
            
            if 'Relative Humidity' in self.df_clean.columns:
                metrics['Avg Humidity'] = f"{self.df_clean['Relative Humidity'].mean():.2f} %"
            
            for key, value in metrics.items():
                f.write(f"{key}: {value}\n")
            
            f.write("\n")
            
            # 3. Data Quality Assessment
            f.write("3. DATA QUALITY ASSESSMENT\n")
            f.write("-"*40 + "\n")
            f.write(f"Missing values in cleaned data: {self.df_clean.isnull().sum().sum()}\n")
            f.write(f"Percentage of complete data: {self.df_clean.notnull().all(axis=1).mean()*100:.1f}%\n\n")
            
            # 4. Key Findings
            f.write("4. KEY FINDINGS AND INSIGHTS\n")
            f.write("-"*40 + "\n")
            
            # Calculate correlations for insights
            insights = []
            
            if all(col in self.df_clean.columns for col in ['Temperature', 'GHI']):
                corr, p_val = stats.pearsonr(self.df_clean['Temperature'].dropna(), 
                                           self.df_clean['GHI'].dropna())
                insights.append(f"Temperature and GHI correlation: {corr:.3f} (p={p_val:.3f})")
            
            if all(col in self.df_clean.columns for col in ['Relative Humidity', 'GHI']):
                corr, p_val = stats.pearsonr(self.df_clean['Relative Humidity'].dropna(), 
                                           self.df_clean['GHI'].dropna())
                insights.append(f"Humidity and GHI correlation: {corr:.3f} (p={p_val:.3f})")
            
            if 'Cloud_Effect_Ratio' in self.df_clean.columns:
                cloud_effect_mean = self.df_clean['Cloud_Effect_Ratio'].mean()
                if cloud_effect_mean < 0.5:
                    insights.append(f"Significant cloud effect observed (average ratio: {cloud_effect_mean:.2f})")
                elif cloud_effect_mean < 0.8:
                    insights.append(f"Moderate cloud effect (average ratio: {cloud_effect_mean:.2f})")
                else:
                    insights.append(f"Minimal cloud effect (average ratio: {cloud_effect_mean:.2f})")
            
            for insight in insights:
                f.write(f"• {insight}\n")
            
            if not insights:
                f.write("Insufficient data for generating insights.\n")
            
            f.write("\n")
            
            # 5. Recommendations
            f.write("5. RECOMMENDATIONS\n")
            f.write("-"*40 + "\n")
            f.write("• Consider using clearsky models for performance benchmarking\n")
            f.write("• Monitor cloud cover patterns for better solar forecasting\n")
            f.write("• Validate sensor readings during peak solar hours\n")
            f.write("• Consider temporal aggregation for trend analysis\n")
            f.write("• Investigate periods with high temperature but low solar irradiance\n\n")
            
            # 6. Files Generated
            f.write("6. ANALYSIS FILES GENERATED\n")
            f.write("-"*40 + "\n")
            for file in os.listdir(self.output_dir):
                if file.endswith(('.png', '.csv', '.txt')):
                    f.write(f"• {file}\n")
        
        print(f"Summary report saved to: {report_path}")
        
        return report_path
    
    def save_cleaned_data(self):
        """Save the cleaned dataset."""
        if self.df_clean is not None:
            clean_path = os.path.join(self.output_dir, 'cleaned_dataset.csv')
            self.df_clean.to_csv(clean_path)
            print(f"Cleaned dataset saved to: {clean_path}")
            return clean_path
        else:
            print("No cleaned data available. Run preprocess_data() first.")
            return None
    
    def run_full_analysis(self):
        """Run the complete analysis pipeline."""
        print("="*80)
        print("STARTING COMPREHENSIVE SOLAR DATA ANALYSIS")
        print("="*80)
        
        # Step 1: Load data
        self.load_data()
        
        # Step 2: Preprocess
        self.preprocess_data()
        
        # Step 3: Generate statistics
        self.generate_basic_statistics()
        
        # Step 4: Correlation analysis
        self.correlation_analysis()
        
        # Step 5: Time series analysis
        self.time_series_analysis()
        
        # Step 6: Scatter plot analysis
        self.scatter_plot_analysis()
        
        # Step 7: Distribution analysis
        self.distribution_analysis()
        
        # Step 8: Generate summary report
        self.generate_summary_report()
        
        # Step 9: Save cleaned data
        self.save_cleaned_data()
        
        print("\n" + "="*80)
        print("ANALYSIS COMPLETED SUCCESSFULLY!")
        print("="*80)
        print(f"\nAll outputs saved to: {os.path.abspath(self.output_dir)}")
        print("\nFiles generated:")
        for file in sorted(os.listdir(self.output_dir)):
            filepath = os.path.join(self.output_dir, file)
            size = os.path.getsize(filepath)
            print(f"  • {file} ({size:,} bytes)")
        
        print("\n" + "="*80)


# ============================================================================
# USAGE EXAMPLE
# ============================================================================

def main():
    """Example usage of the SolarDataAnalyzer class."""
    

    # Create analyzer instance
    #analyzer = SolarDataAnalyzer(output_dir='solar_analysis_output')
    
    # Option 1: Load from sample data (for testing)
    # analyzer.load_data(data_string=sample_data)
    
    # Option 2: Load from file (uncomment and modify for your actual data)
    analyzer = SolarDataAnalyzer(data_path=r'C:\Users\Admin\Documents\python_enviroment\energy\2020-222369-one_axis csv._removed_dialimeters.csv', output_dir='solar_analysis_output')
    analyzer.load_data()
    
    # Run complete analysis
    analyzer.run_full_analysis()
    
    # Alternatively, you can run individual analyses:
    # analyzer.preprocess_data()
    # analyzer.generate_basic_statistics()
    # analyzer.correlation_analysis()
    # analyzer.time_series_analysis()
    # analyzer.scatter_plot_analysis()
    # analyzer.distribution_analysis()
    # analyzer.generate_summary_report()


if __name__ == "__main__":
    main()