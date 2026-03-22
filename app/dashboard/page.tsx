'use client'
import { socket } from './components/socket.js'
import { useEffect, useState } from 'react'



const Dashboard = () => {
type JobCounts = {
  pending: number
  active: number
  completed: number
  failed: number
}

  const [jobs, setJobs] = useState<{[key:string]:string}>({})
const [jobCounts, setJobCounts] = useState<JobCounts>({
  pending: 0,
  active: 0,
  completed: 0,
  failed: 0
})
  const moveJob = (jobId:string,status:string, job : JobCounts)=>{
    console.log(job)
    if(status === 'stats'){
      setJobCounts({
           ...job
      })
    }else{
    setJobs(prev => ({
      ...prev,
      [jobId]: status
    }))
  }
  }

  useEffect(()=>{

  socket.onAny((event : any,data : any)=>{
    console.log("SOCKET EVENT:",event,data)
  })

},[])

    useEffect(() => {

    if (!socket.connected) {
      socket.connect()
    }

    const handleConnect = () => {
      console.log("connected", socket.id)
      socket.emit("join",{group:"user123"})
    }

    const handleJobUpdate = (data :any )=>{
      moveJob(data.jobId,data.type, data)
    }

    socket.on("connect",handleConnect)
    socket.on("job_update",handleJobUpdate)

    return ()=>{
      socket.off("connect",handleConnect)
      socket.off("job_update",handleJobUpdate)
    }

  },[])

  const pending = Object.keys(jobs).filter(j => jobs[j] === "pending")
  const active = Object.keys(jobs).filter(j => jobs[j] === "active")
  const completed = Object.keys(jobs).filter(j => jobs[j] === "completed")
  const failed = Object.keys(jobs).filter(j => jobs[j] === "failed")

  return (
    <main className="min-h-screen bg-gray-100 p-8">

      <header className="mb-10">
        <h1 className="text-3xl font-bold text-gray-800">
          Worker Management Dashboard
        </h1>
        <p className="text-gray-500 mt-2">
          Live job processing monitor
        </p>
      </header>

      {/* Stats */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-10">

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-sm text-gray-500">Pending</h2>
          <p className="text-2xl font-bold">{jobCounts?.pending}</p>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-sm text-gray-500">Active</h2>
          <p className="text-2xl font-bold">{jobCounts?.active}</p>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-sm text-gray-500">Completed</h2>
          <p className="text-2xl font-bold">{jobCounts?.completed}</p>
        </div>

        <div className="bg-white rounded-xl shadow p-6">
          <h2 className="text-sm text-gray-500">Failed</h2>
          <p className="text-2xl font-bold">{jobCounts?.failed}</p>
        </div>

      </section>

      {/* Job Columns */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

        {/* Pending */}
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="font-semibold mb-4 text-yellow-600">Pending</h3>
          {pending.map(job => (
            <div key={job} className="border-b py-2">
              {job}
            </div>
          ))}
        </div>

        {/* Active */}
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="font-semibold mb-4 text-green-600">Active</h3>
          {active.map(job => (
            <div key={job} className="border-b py-2">
              {job}
            </div>
          ))}
        </div>

        {/* Completed */}
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="font-semibold mb-4 text-blue-600">Completed</h3>
          {completed.map(job => (
            <div key={job} className="border-b py-2">
              {job}
            </div>
          ))}
        </div>

        {/* Failed */}
        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="font-semibold mb-4 text-red-600">Failed</h3>
          {failed.map(job => (
            <div key={job} className="border-b py-2">
              {job}
            </div>
          ))}
        </div>

      </section>

    </main>
  )
}

export default Dashboard