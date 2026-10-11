// Initial settling gate only. Once recording starts, retain subsequent anomalies.
export class StabilityGate {
  constructor({windowSeconds=300,maxRangeC=0.5,maxSlopeCPerMinute=0.1,maxGapSeconds=15}={}) {
    Object.assign(this,{windowSeconds,maxRangeC,maxSlopeCPerMinute,maxGapSeconds});this.points=[];
  }
  add(timeMs,temperatureC) {
    if(!Number.isFinite(timeMs)||!Number.isFinite(temperatureC)||temperatureC < -40||temperatureC>85){this.points=[];return {stable:false,duration_seconds:0};}
    const previous=this.points.at(-1);
    if(previous&&(timeMs<=previous.t||timeMs-previous.t>this.maxGapSeconds*1000))this.points=[];
    this.points.push({t:timeMs,v:temperatureC});
    const cutoff=timeMs-this.windowSeconds*1000;
    while(this.points.length>1&&this.points[1].t<=cutoff)this.points.shift();
    const first=this.points[0],duration=(timeMs-first.t)/1000,n=this.points.length;
    let sumX=0,sumY=0,sumXY=0,sumXX=0,min=Infinity,max=-Infinity;
    for(const p of this.points){const x=(p.t-first.t)/60000;sumX+=x;sumY+=p.v;sumXY+=x*p.v;sumXX+=x*x;min=Math.min(min,p.v);max=Math.max(max,p.v);}
    const denominator=n*sumXX-sumX*sumX;
    const slope=denominator>0?(n*sumXY-sumX*sumY)/denominator:0;
    return {stable:duration>=this.windowSeconds&&max-min<=this.maxRangeC&&Math.abs(slope)<=this.maxSlopeCPerMinute,
      duration_seconds:duration,range_c:max-min,slope_c_per_minute:slope,mean_c:sumY/n,sample_count:n};
  }
}
