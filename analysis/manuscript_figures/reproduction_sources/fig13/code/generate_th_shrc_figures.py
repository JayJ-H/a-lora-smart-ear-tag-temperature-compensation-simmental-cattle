from __future__ import annotations
import argparse
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image, ImageDraw, ImageFont
from scipy.stats import gaussian_kde
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error

parser=argparse.ArgumentParser(description='Regenerate the published TH-SHRC Fig. 13 benchmark panels.')
parser.add_argument('--data-dir',type=Path,default=Path(__file__).resolve().parents[1]/'data')
parser.add_argument('--output-dir',type=Path,default=Path(__file__).resolve().parents[1]/'outputs')
parser.add_argument('--publication-layout',action='store_true',help='Export Fig. 13 panels at 63.333 x 125 mm and Fig. 14 panels at 95 x 89.65 mm.')
parser.add_argument('--compact-artwork',action='store_true',help='Remove titles and use compact 7 pt publication styling.')
args=parser.parse_args()
DATA=args.data_dir.resolve(); FIG=args.output_dir.resolve()
FIG.mkdir(parents=True,exist_ok=True)

benchmark=pd.read_csv(DATA/'benchmark_summary.csv')
fold=pd.read_csv(DATA/'benchmark_fold.csv')
pred=pd.read_csv(DATA/'benchmark_predictions.csv')
if len(benchmark)!=33 or benchmark['Model'].nunique()!=33:
    raise RuntimeError('Expected 33 unique benchmark models')
if pred.groupby('Model').size().nunique()!=1 or pred.groupby('Model').size().iloc[0]!=520:
    raise RuntimeError('Expected 520 OOF predictions for each benchmark model')

name_map={'StrictThreeModelStack_reference':'TH-SHRC','DE_XGBoost':'DE-XGBoost','DE_GradientBoosting':'DE-GradientBoosting','LightGBM':'LightGBM','ExtraTrees':'Extra Trees','XGBoost':'XGBoost','BaggedTree':'Bagged Tree','RandomForest':'Random Forest','PSO_RandomForest':'PSO-Random Forest','GWO_ExtraTrees':'GWO-Extra Trees','HistGradientBoosting':'HistGradientBoosting','GA_SVR_RBF':'GA-SVR','SVR_RBF':'SVR-RBF','KNN_k5':'KNN','SA_KNN':'SA-KNN','GaussianProcess_RBF':'Gaussian process','PolynomialRidge':'Polynomial ridge','SplineRidge_GAMLike':'Spline ridge','GradientBoosting':'Gradient boosting','HuberRegressor':'Huber regression','Ridge':'Ridge','BayesianRidge':'Bayesian ridge','ElasticNet':'Elastic net','MultipleLinear':'Multiple linear','Lasso':'Lasso','LinearSVR':'Linear SVR','AdaBoostTree':'AdaBoost','DecisionTree':'Decision tree','EarOnlyLinear':'Ear-only linear','MeanTrain':'Training mean','MLP':'MLP','SGD_Huber':'SGD-Huber','KernelRidge_RBF':'Kernel ridge'}
group_map={'proposed_model_reference':'Proposed model','evolutionary_optimized_ml':'Evolutionary optimization','conventional_ml':'Conventional ML','linear_baseline':'Linear/baseline'}
group_colors={'Proposed model':'#D73027','Evolutionary optimization':'#FC8D59','Conventional ML':'#4575B4','Linear/baseline':'#91BFDB'}
for df in (benchmark,fold,pred):
    df['DisplayModel']=df['Model'].map(name_map).fillna(df['Model']); df['DisplayGroup']=df['BenchmarkGroup'].map(group_map).fillna(df['BenchmarkGroup'])
plt.rcParams.update({'font.family':'serif','font.serif':['Times New Roman','Liberation Serif','DejaVu Serif'],'font.size':9,'axes.labelsize':9,'axes.titlesize':10,'xtick.labelsize':8,'ytick.labelsize':8,'legend.fontsize':8,'axes.linewidth':0.9,'pdf.fonttype':42,'ps.fonttype':42,'svg.fonttype':'none'})
if args.compact_artwork:
    plt.rcParams.update({'font.size':7,'axes.labelsize':7.5,'axes.titlesize':7.5,'xtick.labelsize':7,'ytick.labelsize':7,'legend.fontsize':7,'axes.linewidth':.7})
def clean(ax,axis='x'):
    ax.spines['top'].set_visible(False); ax.spines['right'].set_visible(False); ax.grid(axis=axis,alpha=.18,linewidth=.6)
def legend_groups(ax,loc='lower right'):
    h=[plt.Line2D([0],[0],marker='s',linestyle='',markersize=7,markerfacecolor=c,markeredgecolor='black',label=g) for g,c in group_colors.items()]
    if args.compact_artwork:
        return
    elif args.publication_layout:
        ax.legend(handles=h,frameon=False,loc='upper center',bbox_to_anchor=(.5,.945),bbox_transform=ax.figure.transFigure,ncol=1)
    else:
        ax.legend(handles=h,frameon=False,loc=loc)
def save(fig,stem,dpi=220):
    export_dpi=600 if args.publication_layout else dpi
    fig.savefig(FIG/f'{stem}.png',dpi=export_dpi,facecolor='white')
    fig.savefig(FIG/f'{stem}.svg',facecolor='white')
    fig.savefig(FIG/f'{stem}.pdf',facecolor='white')
    fig.savefig(FIG/f'{stem}.tiff',dpi=export_dpi,facecolor='white',pil_kwargs={'compression':'tiff_lzw'})

# Fig13A all 33 bars
ordered=benchmark.sort_values('RMSE').reset_index(drop=True); p=ordered.iloc[::-1].reset_index(drop=True); y=np.arange(len(p)); cols=p['DisplayGroup'].map(group_colors).tolist(); barpaths=[]
for col,xlab,stem in [('R2','R²','Fig13A1_all33_R2'),('RMSE','RMSE (°C)','Fig13A2_all33_RMSE'),('MAE','MAE (°C)','Fig13A3_all33_MAE')]:
    panel_size=(63.333/25.4,125/25.4) if args.publication_layout else (7.2,10.8)
    fig,ax=plt.subplots(figsize=panel_size); bars=ax.barh(y,p[col],color=cols,edgecolor='black',linewidth=.3,height=.76); ax.set_yticks(y,p['DisplayModel']); ax.set_xlabel(xlab); ax.axvline(0,color='black',lw=.7); clean(ax,'x')
    if args.compact_artwork and col != 'R2':
        ax.tick_params(axis='y',labelleft=False)
    if args.compact_artwork:
        fig.subplots_adjust(left=.43 if col == 'R2' else .07,right=.985,bottom=.065,top=.99)
    elif args.publication_layout:
        fig.suptitle(f'All 33 candidate models: {xlab}',y=.99,fontsize=10)
        fig.subplots_adjust(left=.46,right=.96,bottom=.055,top=.77)
    else:
        ax.set_title(f'All 33 candidate models: {xlab}')
    legend_groups(ax,loc='lower right' if col=='R2' else 'upper right')
    if col=='R2':
        ax.set_xlim(min(-2.42,p[col].min()-.16),1.02)
    elif col=='RMSE':
        ax.set_xlim(0,1.48)
    else:
        ax.set_xlim(0,1.08)
    i=p.index[p['DisplayModel']=='TH-SHRC'][0]; bars[i].set_linewidth(1.7); bars[i].set_hatch('///')
    for yi,(bar,v) in enumerate(zip(bars,p[col])):
        label=f'{v:.3f}'
        if p.loc[yi,'DisplayModel']=='TH-SHRC':
            x=v+(.035 if col=='R2' else .018); ha='left'; color='black'
        elif col=='R2':
            if v >= .22:
                x=v-.035; ha='right'; color='white' if p.loc[yi,'DisplayGroup'] in ('Proposed model','Conventional ML') else 'black'
            elif v <= -.22:
                x=v+.045; ha='left'; color='white' if p.loc[yi,'DisplayGroup']=='Conventional ML' else 'black'
            else:
                x=v+(.035 if v>=0 else -.035); ha='left' if v>=0 else 'right'; color='black'
        else:
            threshold=.23 if col=='RMSE' else .20
            if v >= threshold:
                x=v-.025; ha='right'; color='white' if p.loc[yi,'DisplayGroup'] in ('Proposed model','Conventional ML') else 'black'
            else:
                x=v+.018; ha='left'; color='black'
        ax.text(x,yi,label,va='center',ha=ha,color=color,fontsize=7 if args.compact_artwork else 8,clip_on=False)
    publication_stem={'R2':'Fig13a_R2_33_models','RMSE':'Fig13b_RMSE_33_models','MAE':'Fig13c_MAE_33_models'}[col] if args.publication_layout else stem
    save(fig,publication_stem); plt.close(fig); barpaths.append(FIG/f'{publication_stem}.png')
ims=[Image.open(x).convert('RGB') for x in barpaths]; tw=1500; ims=[im.resize((tw,round(im.height*tw/im.width)),Image.Resampling.LANCZOS) for im in ims]; can=Image.new('RGB',(tw*3,max(i.height for i in ims)),'white')
for i,im in enumerate(ims): can.paste(im,(i*tw,0))
try: panel_font=ImageFont.truetype(r'C:\Windows\Fonts\timesbd.ttf',48)
except OSError: panel_font=ImageFont.load_default()
draw=ImageDraw.Draw(can)
for i,label in enumerate('abc'): draw.text((i*tw+16,10),label,fill='black',font=panel_font)
can.save(FIG/'Fig13_TH_SHRC_benchmark_comparison.png',dpi=(300,300))
can.save(FIG/'Fig13_TH_SHRC_benchmark_comparison.tiff',dpi=(300,300),compression='tiff_lzw')
can.save(FIG/'Fig13_TH_SHRC_benchmark_comparison.pdf',resolution=300.0)

# Fig13B landscape
fig,ax=plt.subplots(figsize=(8.2,6.0))
for g,d in benchmark.groupby('DisplayGroup'):
    ax.scatter(d['RMSE'],d['Within_0_2C']*100,s=60+380*d['Within_0_5C'],color=group_colors[g],edgecolor='black',lw=.5,alpha=.75,label=g)
for nm in ['TH-SHRC','DE-XGBoost','DE-GradientBoosting','LightGBM','Extra Trees','XGBoost','Ear-only linear','Kernel ridge']:
    r=benchmark.loc[benchmark['DisplayModel']==nm].iloc[0]; ax.annotate(nm,(r['RMSE'],r['Within_0_2C']*100),xytext=(5,5),textcoords='offset points',fontsize=7.3)
ax.set_xlabel('RMSE (°C)'); ax.set_ylabel('Records with |error| ≤ 0.2 °C (%)'); ax.set_title('Accuracy landscape of all 33 candidate models'); ax.annotate('',xy=(.10,.90),xytext=(.28,.72),xycoords='axes fraction',arrowprops=dict(arrowstyle='->',lw=1.2)); ax.text(.10,.92,'Better',transform=ax.transAxes,fontsize=8.5,fontweight='bold'); ax.legend(frameon=False,loc='upper right'); clean(ax,'both'); save(fig,'Fig13B_all33_accuracy_landscape'); plt.close(fig)

# Fig13C stability
order_names=ordered['DisplayModel'].tolist(); fold['DisplayModel']=pd.Categorical(fold['DisplayModel'],categories=order_names,ordered=True); fold=fold.sort_values('DisplayModel'); vals=[fold.loc[fold['DisplayModel']==m,'RMSE'].to_numpy() for m in order_names]; pos=np.arange(1,len(order_names)+1)
fig,ax=plt.subplots(figsize=(8.2,11.3)); bp=ax.boxplot(vals,vert=False,positions=pos,widths=.52,patch_artist=True,showfliers=False,medianprops=dict(color='black',lw=1.1)); lookup=benchmark.set_index('DisplayModel')['DisplayGroup'].to_dict()
for b,m in zip(bp['boxes'],order_names): b.set_facecolor(group_colors[lookup[m]]); b.set_alpha(.55); b.set_linewidth(.7)
rng=np.random.default_rng(20260723)
for pp,m,v in zip(pos,order_names,vals):
    jit=rng.normal(pp,.05,len(v)); ax.scatter(v,jit,s=18,color=group_colors[lookup[m]],edgecolor='black',lw=.25,alpha=.9,zorder=3); ax.scatter(np.mean(v),pp,s=32,marker='D',color='black',zorder=4)
ax.set_yticks(pos,order_names); ax.invert_yaxis(); ax.set_xlabel('Five-fold RMSE (°C)'); ax.set_title('Cross-validation stability of all 33 candidate models'); clean(ax,'x'); legend_groups(ax); save(fig,'Fig13C_all33_fold_RMSE_box_jitter'); plt.close(fig)

# Fig13D selected joint plots
def kde(v,grid): return gaussian_kde(v)(grid) if np.std(v,ddof=1)>1e-12 else np.zeros_like(grid)
selected=[('DE_XGBoost','DE-XGBoost','#FC8D59','a'),('EarOnlyLinear','Ear-only linear','#91BFDB','b'),('LightGBM','LightGBM','#4575B4','c'),('TH-SHRC','TH-SHRC','#D73027','d')]; joint=[]
for raw,title,color,panel in selected:
    d=pred[pred['Model']==raw].dropna(subset=['Actual','Predicted']); a=d['Actual'].to_numpy(); pr=d['Predicted'].to_numpy(); joint_size=(95/25.4,89.65/25.4) if args.publication_layout else (6.0,5.4); fig=plt.figure(figsize=joint_size); ax=fig.add_axes([.16,.16,.60,.60]); axt=fig.add_axes([.16,.79,.60,.14],sharex=ax); axr=fig.add_axes([.79,.16,.14,.60],sharey=ax); lo=min(a.min(),pr.min())-.15; hi=max(a.max(),pr.max())+.15; bins=np.linspace(lo,hi,20); grid=np.linspace(lo,hi,250)
    ax.scatter(a,pr,s=6 if args.compact_artwork else 18,facecolor='none',edgecolor=color,lw=.35 if args.compact_artwork else .75,alpha=.55 if args.compact_artwork else .72); ax.plot([lo,hi],[lo,hi],'--',color='black',lw=.7 if args.compact_artwork else 1); ax.set_xlim(lo,hi); ax.set_ylim(lo,hi); ax.set_xlabel('Measured core T (°C)' if args.compact_artwork else 'Measured core temperature (°C)'); ax.set_ylabel('Predicted core T (°C)' if args.compact_artwork else 'Predicted core temperature (°C)'); clean(ax,'both')
    r2=r2_score(a,pr); rmse=mean_squared_error(a,pr)**.5; mae=mean_absolute_error(a,pr); ax.text(.04,.96,f'R²={r2:.3f}\nRMSE={rmse:.3f}\nMAE={mae:.3f}',transform=ax.transAxes,ha='left',va='top',fontsize=7 if args.compact_artwork else None,bbox=dict(boxstyle='square,pad=.2' if args.compact_artwork else 'round,pad=.3',facecolor='white',alpha=.85,lw=.5))
    axt.hist(a,bins=bins,density=True,histtype='step',lw=.7 if args.compact_artwork else 1,color='black',label='Measured'); axt.hist(pr,bins=bins,density=True,alpha=.22,edgecolor=color,color=color,label='Predicted'); axt.plot(grid,kde(a,grid),color='black',lw=.7 if args.compact_artwork else 1.1); axt.plot(grid,kde(pr,grid),color=color,lw=.9 if args.compact_artwork else 1.3); axt.tick_params(labelbottom=False); axt.spines['top'].set_visible(False); axt.spines['right'].set_visible(False); axt.legend(frameon=False,fontsize=7 if args.compact_artwork else 8,ncol=2 if args.compact_artwork else (1 if args.publication_layout else 2),handlelength=1.1,loc='lower center',bbox_to_anchor=(.5,1.02),borderaxespad=0)
    axr.hist(a,bins=bins,density=True,orientation='horizontal',histtype='step',lw=.7 if args.compact_artwork else 1,color='black'); axr.hist(pr,bins=bins,density=True,orientation='horizontal',alpha=.22,edgecolor=color,color=color); axr.plot(kde(a,grid),grid,color='black',lw=.7 if args.compact_artwork else 1.1); axr.plot(kde(pr,grid),grid,color=color,lw=.9 if args.compact_artwork else 1.3); axr.tick_params(labelleft=False); axr.spines['top'].set_visible(False); axr.spines['right'].set_visible(False)
    if not args.compact_artwork:
        fig.suptitle(f'{title}: OOF predicted vs measured (Hist + KDE)',y=.99,fontsize=10.5)
    stem='Fig14'+panel+'_'+title.replace(' ','_').replace('-','_'); save(fig,stem); plt.close(fig); joint.append(FIG/f'{stem}.png')
ims=[Image.open(x).convert('RGB') for x in joint]; w,h=1300,1180; ims=[im.resize((w,h),Image.Resampling.LANCZOS) for im in ims]; can=Image.new('RGB',(w*2,h*2),'white'); can.paste(ims[0],(0,0)); can.paste(ims[1],(w,0)); can.paste(ims[2],(0,h)); can.paste(ims[3],(w,h)); draw=ImageDraw.Draw(can)
for i,label in enumerate('abcd'):
    x=(i%2)*w+14; y=(i//2)*h+8; draw.text((x,y),label,fill='black',font=panel_font)
can.save(FIG/'Fig14_representative_models_joint_composite.png',dpi=(300,300))
can.save(FIG/'Fig14_representative_models_joint_composite.tiff',dpi=(300,300),compression='tiff_lzw')
can.save(FIG/'Fig14_representative_models_joint_composite.pdf',resolution=300.0)

print('done')
